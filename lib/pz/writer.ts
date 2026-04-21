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
 *   5. Re-read the current file. Mtime-race check:
 *        - If the caller's `clientMtimeMs` matches disk mtime (sec
 *          resolution) we trust the patch and proceed.
 *        - If mtimes differ AND the caller supplied `priorValues`
 *          (the per-key baseline the client saw at load time), we do
 *          a three-way merge: for each key in the patch compare the
 *          current disk value to `priorValues[k]`. Keys whose disk
 *          value already equals the patch value are dropped as no-ops.
 *          If the remaining keys all have disk === prior, PZ/another
 *          admin didn't touch them and we proceed with the reduced
 *          patch. Otherwise the mismatched keys are returned as
 *          `conflicts` with code `mtime-race`.
 *        - If mtimes differ and no `priorValues` were supplied we
 *          keep the old strict behaviour (`mtime-race` without
 *          conflict list) for back-compat.
 *      PZ routinely rewrites the ini/sandbox files on disk even when
 *      nothing semantic changed (servername echo, backup flush,
 *      admin-command persist), so the three-way merge is what makes
 *      the UX tolerable on a live server.
 *   6. Serialize — `serialize-ini` (line-based) for server.ini, offset-
 *      based for SandboxVars.
 *   7. Copy the old file into `.backups/<name>.bak-<iso>` before touching
 *      the original; prune to newest 10 per original-name.
 *   8. Atomic write: write to `.<name>.tmp-<rand>` in the same directory,
 *      fsync, rename over the original.
 *   9. Return `{ ok: true, diff, newMtimeMs, backupPath, droppedKeys? }`.
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

export interface MtimeConflict {
  path: string;
  /** Value the client thought was there when it loaded the config. */
  prior: unknown;
  /** Value the client wanted to write. */
  patch: unknown;
  /** Value currently on disk (differs from `prior`). */
  disk: unknown;
}

export type WriteOutcome =
  | {
      ok: true;
      diff: WriteDiffEntry[];
      newMtimeMs: number;
      backupPath: string;
      /**
       * Keys that were in the patch but already matched disk (no-ops
       * that we silently dropped). Empty/absent means the write used
       * the patch as-is. Populated only via the three-way merge path.
       */
      droppedKeys?: string[];
    }
  | {
      ok: false;
      code: WriteFailureCode;
      detail: string;
      errors?: Array<{ path: string; code: string; message: string }>;
      /**
       * Per-key disagreement list when `code === "mtime-race"` and the
       * caller supplied `priorValues`. Absent when the client sent no
       * baseline or when the conflict is purely an mtime mismatch with
       * no actionable per-key data.
       */
      conflicts?: MtimeConflict[];
    };

export interface WriteOpts {
  clientMtimeMs: number;
  /**
   * Per-key baseline values the client had in memory when it built
   * this patch (pre-edit, as returned by the last GET). Used by the
   * three-way merge logic to decide whether an mtime drift is safe
   * to ignore. Optional — if omitted the writer falls back to the
   * strict mtime check.
   */
  priorValues?: Record<string, string | number | boolean>;
}

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

/** Normalise values the way a user-typed patch would produce before
 * comparing them. PZ persists booleans as the strings `"true"`/`"false"`
 * and numbers may round-trip as decimals even when the descriptor is
 * `int`, so a loose-equality compare here is deliberately tolerant. */
function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  if (typeof a === "boolean" || typeof b === "boolean") {
    return String(a).toLowerCase() === String(b).toLowerCase();
  }
  if (typeof a === "number" || typeof b === "number") {
    const an = Number(a);
    const bn = Number(b);
    if (Number.isFinite(an) && Number.isFinite(bn)) return an === bn;
  }
  return String(a) === String(b);
}

/**
 * Three-way merge between the caller's snapshot (`priorValues`), the
 * fresh on-disk state (`diskValues`) and the write target (`patch`):
 *
 *   - disk already equals patch         → drop key (no-op, PZ or
 *                                          someone else already did it)
 *   - disk equals prior                 → safe to write (nobody else
 *                                          changed this key since load)
 *   - disk differs from both            → conflict; caller must resolve
 *
 * Returns the pruned patch and any conflicts. The caller only proceeds
 * with the write when `conflicts` is empty.
 */
function mergePatchAgainstDisk(
  patch: Record<string, string | number | boolean>,
  diskValues: Record<string, unknown>,
  priorValues: Record<string, string | number | boolean>,
): {
  mergedPatch: Record<string, string | number | boolean>;
  droppedKeys: string[];
  conflicts: MtimeConflict[];
} {
  const mergedPatch: Record<string, string | number | boolean> = {};
  const droppedKeys: string[] = [];
  const conflicts: MtimeConflict[] = [];
  for (const [k, to] of Object.entries(patch)) {
    const disk = diskValues[k];
    if (valuesEqual(disk, to)) {
      droppedKeys.push(k);
      continue;
    }
    const prior = priorValues[k];
    if (prior !== undefined && valuesEqual(disk, prior)) {
      mergedPatch[k] = to;
      continue;
    }
    conflicts.push({ path: k, prior, patch: to, disk });
  }
  return { mergedPatch, droppedKeys, conflicts };
}

// ---------- INI ----------

export async function writeServerIni(
  patch: Record<string, string | number | boolean>,
  opts: WriteOpts,
): Promise<WriteOutcome> {
  if (Object.keys(patch).length === 0) {
    return { ok: false, code: "empty-patch", detail: "no keys in patch" };
  }
  const notReady = ensureReady();
  if (notReady) return notReady;

  return writeMutex.runExclusive(async () => {
    const v = validateIniPatch(patch);
    if (!v.ok) {
      return {
        ok: false,
        code: "validation",
        detail: "patch failed descriptor validation",
        errors: v.errors,
      };
    }

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

    let effectivePatch = patch;
    let droppedKeys: string[] = [];
    const mtimeDrift =
      Math.floor(current.mtimeMs / 1000) !==
      Math.floor(opts.clientMtimeMs / 1000);
    if (mtimeDrift) {
      if (!opts.priorValues) {
        return {
          ok: false,
          code: "mtime-race",
          detail: `client mtime ${opts.clientMtimeMs} != disk ${current.mtimeMs}`,
        };
      }
      const merge = mergePatchAgainstDisk(
        patch,
        current.parsed?.map ?? {},
        opts.priorValues,
      );
      if (merge.conflicts.length > 0) {
        return {
          ok: false,
          code: "mtime-race",
          detail: `client mtime ${opts.clientMtimeMs} != disk ${current.mtimeMs}; ${merge.conflicts.length} key(s) changed on disk`,
          conflicts: merge.conflicts,
        };
      }
      effectivePatch = merge.mergedPatch;
      droppedKeys = merge.droppedKeys;
      if (Object.keys(effectivePatch).length === 0) {
        // Everything the user wanted was already on disk.
        return {
          ok: true,
          diff: [],
          newMtimeMs: current.mtimeMs,
          backupPath: "",
          droppedKeys,
        };
      }
    }

    const diff: WriteDiffEntry[] = [];
    const prevMap = current.parsed?.map ?? {};
    for (const [k, to] of Object.entries(effectivePatch)) {
      diff.push({ path: k, from: prevMap[k], to });
    }

    let newRaw: string;
    try {
      newRaw = serializeIni(current.raw, effectivePatch);
    } catch (e) {
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
    return {
      ok: true,
      diff,
      newMtimeMs: s.mtimeMs,
      backupPath,
      droppedKeys: droppedKeys.length > 0 ? droppedKeys : undefined,
    };
  });
}

// ---------- Sandbox ----------

export async function writeSandboxVars(
  patch: Record<string, string | number | boolean>,
  opts: WriteOpts,
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

    let effectivePatch = patch;
    let droppedKeys: string[] = [];
    const mtimeDrift =
      Math.floor(current.mtimeMs / 1000) !==
      Math.floor(opts.clientMtimeMs / 1000);
    if (mtimeDrift) {
      if (!opts.priorValues) {
        return {
          ok: false,
          code: "mtime-race",
          detail: `client mtime ${opts.clientMtimeMs} != disk ${current.mtimeMs}`,
        };
      }
      const merge = mergePatchAgainstDisk(
        patch,
        current.parsed?.flat ?? {},
        opts.priorValues,
      );
      if (merge.conflicts.length > 0) {
        return {
          ok: false,
          code: "mtime-race",
          detail: `client mtime ${opts.clientMtimeMs} != disk ${current.mtimeMs}; ${merge.conflicts.length} key(s) changed on disk`,
          conflicts: merge.conflicts,
        };
      }
      effectivePatch = merge.mergedPatch;
      droppedKeys = merge.droppedKeys;
      if (Object.keys(effectivePatch).length === 0) {
        return {
          ok: true,
          diff: [],
          newMtimeMs: current.mtimeMs,
          backupPath: "",
          droppedKeys,
        };
      }
    }

    const diff: WriteDiffEntry[] = [];
    const prevFlat = current.parsed?.flat ?? {};
    for (const [k, to] of Object.entries(effectivePatch)) {
      diff.push({ path: k, from: prevFlat[k], to });
    }

    let newRaw: string;
    try {
      newRaw = serializeSandboxLua(current.raw, effectivePatch);
    } catch (e) {
      if (e instanceof UnknownSandboxKeyError) {
        return { ok: false, code: "unknown-key", detail: e.message };
      }
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
    return {
      ok: true,
      diff,
      newMtimeMs: s.mtimeMs,
      backupPath,
      droppedKeys: droppedKeys.length > 0 ? droppedKeys : undefined,
    };
  });
}
