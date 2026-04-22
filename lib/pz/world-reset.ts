/**
 * World-reset primitives — destructive but reversible.
 *
 * Rather than `rm -rf` the save directories, we rename the target into
 * a sibling `.trash-<iso>` folder. This turns a catastrophic mistake
 * into a single `mv` recovery while still freeing the path for PZ to
 * regenerate a fresh world on next boot. Old trash folders are pruned
 * by count (keep the last `TRASH_RETENTION`) so disk usage stays
 * bounded.
 *
 * Two modes:
 *   - `world`       — trash only `Saves/Multiplayer/<prefix>/`. Keeps
 *                     server config (`.ini`, `_SandboxVars.lua`) and
 *                     the whitelist/access DB intact, so admins stay
 *                     admins and sandbox tuning survives.
 *   - `total-nuke`  — trash the whole `Saves/` folder *and* the
 *                     `<prefix>.db` (whitelist + access levels). Only
 *                     configs survive; the next boot is a pristine
 *                     server with no accounts.
 *
 * Safety invariants enforced by `wipeWorld`:
 *   1. The PZ container MUST be reported as stopped (caller passes in
 *      the inspection result). We never wipe a running world.
 *   2. Every target path is re-verified to live under `PZ_DATA_DIR`
 *      before being renamed — defends against `prefix` injection via
 *      a compromised `PZ_SERVER_PREFIX` env.
 *   3. Missing paths are no-ops, not errors — an already-clean server
 *      should still report success.
 *
 * Returns a structured outcome describing exactly which paths were
 * trashed (for audit logging and UI feedback) and which trash entries
 * were pruned.
 */

import { readdir, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { detectServerPrefix } from "./config-reader";
import { getLogger } from "@/lib/logger";

const log = () => getLogger().child({ mod: "pz/world-reset" });

export type ResetMode = "world" | "total-nuke";

const dataDir = (): string => {
  // PZ_DATA_DIR is the PZ volume root; PZ_CONFIG_DIR is a child
  // (typically <data>/Server). We fall back to the parent of
  // PZ_CONFIG_DIR so deployments don't need a new env var.
  if (process.env.PZ_DATA_DIR) return process.env.PZ_DATA_DIR;
  if (process.env.PZ_CONFIG_DIR) return dirname(process.env.PZ_CONFIG_DIR);
  return "/pz-data";
};

const TRASH_RETENTION = 3;

export interface TrashedEntry {
  /** Absolute path that was renamed. */
  from: string;
  /** Absolute path of the trash folder it was renamed to. */
  to: string;
  /** Bytes-on-disk estimate at rename time (0 for missing or file nodes). */
  approxBytes: number;
}

export interface PrunedTrash {
  path: string;
}

export interface WipeOutcome {
  ok: true;
  mode: ResetMode;
  prefix: string;
  trashed: TrashedEntry[];
  pruned: PrunedTrash[];
}

export interface WipeFailure {
  ok: false;
  code:
    | "server-still-running"
    | "prefix-unsafe"
    | "data-dir-unreachable"
    | "rename-failed";
  detail: string;
}

export type WipeResult = WipeOutcome | WipeFailure;

function isoStamp(d = new Date()): string {
  // Compact, sortable, filesystem-safe: 20260421T190203Z
  return d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+/, "")
    .replace(/Z$/, "Z");
}

function ensureUnder(root: string, candidate: string): boolean {
  const r = resolve(root);
  const c = resolve(candidate);
  if (c === r) return true;
  // `relative(r, c)` is e.g. "Saves/Multiplayer/x" when c is inside r,
  // or "../foo" / an absolute path when c escapes. This is the
  // cross-platform way to express "is c under r" and works on both
  // POSIX and Windows without string-concatenating separators.
  const rel = relative(r, c);
  if (!rel) return false;
  return !rel.startsWith("..") && !isAbsolute(rel);
}

async function approxSize(path: string): Promise<number> {
  try {
    const s = await stat(path);
    return s.isFile() ? s.size : 0;
  } catch {
    return 0;
  }
}

async function trashIfExists(
  src: string,
  trashRoot: string,
  stamp: string,
): Promise<TrashedEntry | null> {
  try {
    await stat(src);
  } catch {
    // Missing — nothing to do.
    log().debug({ src }, "trash: src missing, skipping");
    return null;
  }
  const dest = join(trashRoot, `${basename(src)}.trash-${stamp}`);
  const bytes = await approxSize(src);
  await rename(src, dest);
  log().warn({ src, dest }, "trash: renamed");
  return { from: src, to: dest, approxBytes: bytes };
}

/**
 * Delete all but the most recent `TRASH_RETENTION` entries whose name
 * matches `<basename>.trash-*` under `trashRoot`. Sorted lexically
 * which, thanks to the isoStamp format, equals chronological.
 */
async function pruneTrash(
  trashRoot: string,
  baseName: string,
): Promise<PrunedTrash[]> {
  let entries: string[] = [];
  try {
    entries = await readdir(trashRoot);
  } catch {
    return [];
  }
  const pattern = new RegExp(`^${baseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.trash-`);
  const matching = entries.filter((e) => pattern.test(e)).sort();
  if (matching.length <= TRASH_RETENTION) return [];
  const toDelete = matching.slice(0, matching.length - TRASH_RETENTION);
  const pruned: PrunedTrash[] = [];
  for (const name of toDelete) {
    const p = join(trashRoot, name);
    try {
      await rm(p, { recursive: true, force: true });
      log().info({ path: p }, "trash: pruned");
      pruned.push({ path: p });
    } catch (e) {
      log().error(
        { path: p, err: e instanceof Error ? e.message : String(e) },
        "trash: prune failed",
      );
    }
  }
  return pruned;
}

/**
 * Execute a world reset. Caller is responsible for confirming PZ is
 * stopped before invoking (we verify via the passed flag to fail loud
 * rather than catch silently).
 */
export async function wipeWorld(args: {
  mode: ResetMode;
  containerRunning: boolean;
}): Promise<WipeResult> {
  if (args.containerRunning) {
    return {
      ok: false,
      code: "server-still-running",
      detail: "PZ container must be stopped before a world wipe",
    };
  }

  const prefix = await detectServerPrefix();
  // Guard against prefix values that contain path separators or are
  // suspiciously weird. Only [A-Za-z0-9_.-] are legal in PZ prefixes.
  if (!/^[A-Za-z0-9_.-]+$/.test(prefix)) {
    return {
      ok: false,
      code: "prefix-unsafe",
      detail: `refusing to wipe with prefix='${prefix}' — contains unsafe characters`,
    };
  }

  const root = dataDir();
  try {
    await stat(root);
  } catch {
    return {
      ok: false,
      code: "data-dir-unreachable",
      detail: `PZ_DATA_DIR not accessible: ${root}`,
    };
  }

  const worldDir = join(root, "Saves", "Multiplayer", prefix);
  const savesRoot = join(root, "Saves");
  const userDb = join(root, "Server", `${prefix}.db`);

  // Path-safety check: everything we're about to rename MUST live
  // under the data-dir. Belt-and-suspenders against bad prefixes.
  const targets = args.mode === "world" ? [worldDir] : [savesRoot, userDb];
  for (const t of targets) {
    if (!ensureUnder(root, t)) {
      return {
        ok: false,
        code: "prefix-unsafe",
        detail: `target path ${t} is not under data dir ${root}`,
      };
    }
  }

  const stamp = isoStamp();
  const trashed: TrashedEntry[] = [];
  try {
    for (const t of targets) {
      const parent = dirname(t);
      const entry = await trashIfExists(t, parent, stamp);
      if (entry) trashed.push(entry);
    }
  } catch (e) {
    return {
      ok: false,
      code: "rename-failed",
      detail: e instanceof Error ? e.message : String(e),
    };
  }

  // Prune old trash entries per-parent so each location independently
  // keeps the last TRASH_RETENTION generations.
  const pruned: PrunedTrash[] = [];
  const seenParents = new Set<string>();
  for (const t of trashed) {
    const parent = dirname(t.from);
    const base = basename(t.from);
    const key = `${parent}::${base}`;
    if (seenParents.has(key)) continue;
    seenParents.add(key);
    pruned.push(...(await pruneTrash(parent, base)));
  }

  log().warn(
    {
      mode: args.mode,
      prefix,
      trashedCount: trashed.length,
      prunedCount: pruned.length,
    },
    "world reset complete",
  );
  return { ok: true, mode: args.mode, prefix, trashed, pruned };
}
