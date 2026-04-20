/**
 * Atomic, mutex-protected, mtime-checked writer for the two PZ config
 * files.
 *
 * Flow (shared by `writeServerIni` / `writeSandboxVars`):
 *   1. Reject empty patches early (`empty-patch`).
 *   2. `ensureReady()` — checks FS access via access-check + lifecycle
 *      phase via the registered getter. Returns typed failure if not
 *      ready; the writer never attempts I/O in that state.
 *   3. Acquire the module-level mutex (single writer at a time across
 *      both files).
 *   4. Validate the patch against descriptor-driven Zod schemas.
 *   5. Re-read the current file. If the caller's `clientMtimeMs` doesn't
 *      match the file's current mtime (rounded to the second), reject as
 *      `mtime-race`.
 *   6. Serialize — `serialize-ini` (line-based) for server.ini, offset-
 *      based for SandboxVars.
 *   7. Copy the old file into `.backups/<name>.bak-<iso>` before touching
 *      the original; prune to newest 10 per original-name.
 *   8. Atomic write: write to `.<name>.tmp-<rand>` in the same directory,
 *      fsync, rename over the original.
 *   9. Return `{ ok: true, diff, newMtimeMs, backupPath }`.
 *
 * `registerLifecyclePhaseGetter()` is used by the lifecycle module (Chunk 5)
 * to feed its current phase string into the writer without a circular
 * import. Default is `() => "idle"` so tests don't need to register.
 */

import { Mutex } from "async-mutex";
import { randomBytes } from "node:crypto";
import {
  copyFile,
  mkdir,
  open,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { getConfigAccessOk } from "./access-check";
import {
  readSandboxVars,
  readServerIni,
  type SandboxVarsResult,
  type ServerIniResult,
} from "./config-reader";
import { serializeIni } from "./serialize-ini";
import {
  serializeSandboxLua,
  UnknownSandboxKeyError,
} from "./serialize-sandbox-lua";
import { validateIniPatch, validateSandboxPatch } from "./validate";

const writeMutex = new Mutex();

let lifecyclePhaseGetter: () => string = () => "idle";

/**
 * Inject a function returning the current lifecycle phase string. Used by
 * the lifecycle module so the writer can block writes during start/stop
 * without a circular import. Default getter returns "idle".
 */
export function registerLifecyclePhaseGetter(fn: () => string): void {
  lifecyclePhaseGetter = fn;
}

/** Reset the getter to its default. Test helper; not part of the runtime flow. */
export function __resetLifecyclePhaseGetterForTests(): void {
  lifecyclePhaseGetter = () => "idle";
}

const configDir = (): string => process.env.PZ_CONFIG_DIR ?? "/pz-data/Server";
const backupDir = (): string => process.env.PZ_BACKUP_DIR ?? join(configDir(), ".backups");

export type WriteFailureCode =
  | "config-dir-unreachable"
  | "config-busy"
  | "lifecycle-busy"
  | "mtime-race"
  | "validation"
  | "unknown-key"
  | "serialize-shape-unsupported"
  | "io"
  | "empty-patch";

export interface WriteDiffEntry {
  path: string;
  from: unknown;
  to: unknown;
}

export type WriteOutcome =
  | {
      ok: true;
      diff: WriteDiffEntry[];
      newMtimeMs: number;
      backupPath: string;
    }
  | {
      ok: false;
      code: WriteFailureCode;
      detail: string;
      errors?: Array<{ path: string; code: string; message: string }>;
    };

async function ensureBackupsDir(): Promise<void> {
  await mkdir(backupDir(), { recursive: true });
}

async function backup(file: string): Promise<string> {
  await ensureBackupsDir();
  const iso = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = join(backupDir(), `${basename(file)}.bak-${iso}`);
  await copyFile(file, dest);
  // Prune: keep newest 10 per original-filename.
  const all = await readdir(backupDir());
  const mine = all.filter((f) => f.startsWith(`${basename(file)}.bak-`)).sort();
  const excess = Math.max(0, mine.length - 10);
  if (excess > 0) {
    const toRemove = mine.slice(0, excess);
    for (const f of toRemove) {
      await unlink(join(backupDir(), f)).catch(() => {});
    }
  }
  return dest;
}

async function atomicWrite(file: string, content: string): Promise<void> {
  const tmp = join(
    dirname(file),
    `.${basename(file)}.tmp-${randomBytes(6).toString("hex")}`,
  );
  await writeFile(tmp, content, "utf8");
  // fsync so the content is on disk before the rename.
  const fh = await open(tmp, "r+");
  try {
    await fh.sync();
  } finally {
    await fh.close();
  }
  await rename(tmp, file);
}

function ensureReady(): WriteOutcome | null {
  if (!getConfigAccessOk()) {
    return {
      ok: false,
      code: "config-dir-unreachable",
      detail: "fs.access failed (see access-check logs)",
    };
  }
  const phase = lifecyclePhaseGetter();
  if (phase !== "idle") {
    return {
      ok: false,
      code: "lifecycle-busy",
      detail: `phase=${phase}`,
    };
  }
  return null;
}

// ---------- INI ----------

export async function writeServerIni(
  patch: Record<string, string | number | boolean>,
  opts: { clientMtimeMs: number },
): Promise<WriteOutcome> {
  if (Object.keys(patch).length === 0) {
    return { ok: false, code: "empty-patch", detail: "no keys in patch" };
  }
  const notReady = ensureReady();
  if (notReady) return notReady;

  return writeMutex.runExclusive(async () => {
    // 1. Validate.
    const v = validateIniPatch(patch);
    if (!v.ok) {
      return {
        ok: false,
        code: "validation",
        detail: "patch failed descriptor validation",
        errors: v.errors,
      };
    }

    // 2. Read current.
    let current: ServerIniResult;
    try {
      current = await readServerIni();
    } catch (e) {
      return {
        ok: false,
        code: "io",
        detail: e instanceof Error ? e.message : String(e),
      };
    }
    if (!current.ok || current.raw === undefined || current.mtimeMs === undefined) {
      return {
        ok: false,
        code: "io",
        detail: current.error ?? "could not read server.ini",
      };
    }

    // 3. mtime check (second-resolution to tolerate FS rounding).
    if (Math.floor(current.mtimeMs / 1000) !== Math.floor(opts.clientMtimeMs / 1000)) {
      return {
        ok: false,
        code: "mtime-race",
        detail: `client mtime ${opts.clientMtimeMs} != disk ${current.mtimeMs}`,
      };
    }

    // 4. Diff (from vs to).
    const diff: WriteDiffEntry[] = [];
    const prevMap = current.parsed?.map ?? {};
    for (const [k, to] of Object.entries(patch)) {
      diff.push({ path: k, from: prevMap[k], to });
    }

    // 5. Serialize.
    let newRaw: string;
    try {
      newRaw = serializeIni(current.raw, patch);
    } catch (e) {
      return {
        ok: false,
        code: "serialize-shape-unsupported",
        detail: e instanceof Error ? e.message : String(e),
      };
    }

    // 6. Backup, then atomic write.
    let backupPath: string;
    try {
      backupPath = await backup(current.path);
    } catch (e) {
      return {
        ok: false,
        code: "io",
        detail: `backup failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
    try {
      await atomicWrite(current.path, newRaw);
    } catch (e) {
      return {
        ok: false,
        code: "io",
        detail: `atomicWrite failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
    const s = await stat(current.path);
    return { ok: true, diff, newMtimeMs: s.mtimeMs, backupPath };
  });
}

// ---------- Sandbox ----------

export async function writeSandboxVars(
  patch: Record<string, string | number | boolean>,
  opts: { clientMtimeMs: number },
): Promise<WriteOutcome> {
  if (Object.keys(patch).length === 0) {
    return { ok: false, code: "empty-patch", detail: "no keys in patch" };
  }
  const notReady = ensureReady();
  if (notReady) return notReady;

  return writeMutex.runExclusive(async () => {
    const v = validateSandboxPatch(patch);
    if (!v.ok) {
      return {
        ok: false,
        code: "validation",
        detail: "patch failed descriptor validation",
        errors: v.errors,
      };
    }

    let current: SandboxVarsResult;
    try {
      current = await readSandboxVars();
    } catch (e) {
      return {
        ok: false,
        code: "io",
        detail: e instanceof Error ? e.message : String(e),
      };
    }
    if (!current.ok || current.raw === undefined || current.mtimeMs === undefined) {
      return {
        ok: false,
        code: "io",
        detail: current.error ?? "could not read sandbox vars",
      };
    }

    if (Math.floor(current.mtimeMs / 1000) !== Math.floor(opts.clientMtimeMs / 1000)) {
      return {
        ok: false,
        code: "mtime-race",
        detail: `client mtime ${opts.clientMtimeMs} != disk ${current.mtimeMs}`,
      };
    }

    const diff: WriteDiffEntry[] = [];
    const prevFlat = current.parsed?.flat ?? {};
    for (const [k, to] of Object.entries(patch)) {
      diff.push({ path: k, from: prevFlat[k], to });
    }

    let newRaw: string;
    try {
      newRaw = serializeSandboxLua(current.raw, patch);
    } catch (e) {
      if (e instanceof UnknownSandboxKeyError) {
        return { ok: false, code: "unknown-key", detail: e.message };
      }
      // Unexpected error from serializer treated as shape unsupported.
      return {
        ok: false,
        code: "serialize-shape-unsupported",
        detail: e instanceof Error ? e.message : String(e),
      };
    }

    let backupPath: string;
    try {
      backupPath = await backup(current.path);
    } catch (e) {
      return {
        ok: false,
        code: "io",
        detail: `backup failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
    try {
      await atomicWrite(current.path, newRaw);
    } catch (e) {
      return {
        ok: false,
        code: "io",
        detail: `atomicWrite failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
    const s = await stat(current.path);
    return { ok: true, diff, newMtimeMs: s.mtimeMs, backupPath };
  });
}
