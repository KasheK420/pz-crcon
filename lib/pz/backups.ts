/**
 * World-snapshot backup manager.
 *
 * Single tarball per backup — `Saves/Multiplayer/<prefix>/`, the server
 * config INI, the sandbox Lua, and the user DB. Stored under
 * `$PZ_BACKUP_ROOT/` (default `/pz-data/backups/pz-crcon/`). The pz-crcon
 * container ships with `tar` + `gzip` in its Alpine base, so creating /
 * extracting is done via `child_process.spawn` rather than a pure-JS
 * tar implementation — less code, fewer dependencies, correct permission
 * handling on cross-filesystem copies.
 *
 * Safety invariants:
 *   - Every target path must live under `$PZ_DATA_DIR` before we rename /
 *     spawn / unlink. We re-verify on every op rather than trusting the
 *     Prisma row, in case a mischievous filename snuck in.
 *   - Restore refuses while the PZ container is reported running. The
 *     caller is responsible for passing the running flag; the lifecycle
 *     module owns the stop sequencing.
 *   - Create happens on a live server — PZ writes world saves every N
 *     minutes, so a hot tarball is not bit-perfect. That's acceptable
 *     for a point-in-time snapshot; operators who want bit-perfect
 *     backups should run the lifecycle "save world then backup".
 *   - Retention: keep all MANUAL + PRE_RESTART + PRE_MOD_UPDATE, and the
 *     latest N AUTO tarballs (default 14).
 */

import { spawn } from "node:child_process";
import {
  access,
  constants,
  mkdir,
  readdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { createReadStream } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { prisma } from "@/lib/db/client";
import type { Backup, BackupKind } from "@prisma/client";
import { detectServerPrefix } from "./config-reader";
import { getLogger } from "@/lib/logger";

const log = () => getLogger().child({ mod: "pz/backups" });

const DEFAULT_AUTO_RETENTION = 14;

const dataDir = (): string => {
  if (process.env.PZ_DATA_DIR) return process.env.PZ_DATA_DIR;
  if (process.env.PZ_CONFIG_DIR) return dirname(process.env.PZ_CONFIG_DIR);
  return "/pz-data";
};

const backupRoot = (): string => {
  const override = process.env.PZ_BACKUP_ROOT;
  if (override) return override;
  return join(dataDir(), "backups", "pz-crcon");
};

function ensureUnder(root: string, candidate: string): boolean {
  const r = resolve(root);
  const c = resolve(candidate);
  if (c === r) return true;
  const rel = relative(r, c);
  if (!rel) return false;
  return !rel.startsWith("..") && !isAbsolute(rel);
}

function isoStamp(d = new Date()): string {
  return d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+/, "")
    .replace(/Z$/, "Z");
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export interface BackupRow {
  id: string;
  filename: string;
  sizeBytes: number;
  kind: BackupKind;
  modCount: number | null;
  createdAt: string;
  createdById: string | null;
  notes: string | null;
  exists: boolean;
  absolutePath: string;
}

function toRow(b: Backup, exists: boolean): BackupRow {
  return {
    id: b.id,
    filename: b.filename,
    sizeBytes: Number(b.sizeBytes),
    kind: b.kind,
    modCount: b.modCount,
    createdAt: b.createdAt.toISOString(),
    createdById: b.createdById,
    notes: b.notes,
    exists,
    absolutePath: join(backupRoot(), b.filename),
  };
}

export interface ListBackupsResult {
  rows: BackupRow[];
  /** Files in the backup dir without a matching DB row (orphaned). */
  orphans: Array<{ filename: string; sizeBytes: number; mtime: string }>;
  backupRoot: string;
  total: number;
}

export async function listBackups(): Promise<ListBackupsResult> {
  const root = backupRoot();
  await mkdir(root, { recursive: true });
  const rows = await prisma.backup.findMany({
    orderBy: { createdAt: "desc" },
  });
  const known = new Set(rows.map((r) => r.filename));
  const fsEntries = await readdir(root);
  const orphans: ListBackupsResult["orphans"] = [];
  for (const f of fsEntries) {
    if (!f.endsWith(".tar.gz")) continue;
    if (known.has(f)) continue;
    try {
      const s = await stat(join(root, f));
      orphans.push({
        filename: f,
        sizeBytes: s.size,
        mtime: new Date(s.mtimeMs).toISOString(),
      });
    } catch {
      // ignore
    }
  }
  const withExists = await Promise.all(
    rows.map(async (r) => {
      const exists = await fileExists(join(root, r.filename));
      return toRow(r, exists);
    }),
  );
  return {
    rows: withExists,
    orphans,
    backupRoot: root,
    total: withExists.length,
  };
}

async function runTar(args: string[], cwd: string): Promise<{
  ok: boolean;
  code: number | null;
  stderr: string;
}> {
  return new Promise((resolvePromise) => {
    const child = spawn("tar", args, { cwd });
    const errChunks: Buffer[] = [];
    child.stderr.on("data", (b: Buffer) => {
      errChunks.push(b);
    });
    child.on("error", (e) => {
      resolvePromise({ ok: false, code: null, stderr: String(e) });
    });
    child.on("close", (code) => {
      resolvePromise({
        ok: code === 0,
        code,
        stderr: Buffer.concat(errChunks).toString("utf8"),
      });
    });
  });
}

export type CreateFailure =
  | { ok: false; code: "backup-dir-unwritable"; detail: string }
  | { ok: false; code: "data-dir-unreachable"; detail: string }
  | { ok: false; code: "world-missing"; detail: string }
  | { ok: false; code: "tar-failed"; detail: string };

export interface CreateResult {
  ok: true;
  row: BackupRow;
  pruned: string[];
}

export async function createBackup(opts: {
  kind: BackupKind;
  userId?: string | null;
  notes?: string | null;
  autoRetention?: number;
}): Promise<CreateResult | CreateFailure> {
  const root = backupRoot();
  const dd = dataDir();
  try {
    await stat(dd);
  } catch (e) {
    return {
      ok: false,
      code: "data-dir-unreachable",
      detail: `PZ_DATA_DIR not accessible: ${dd} (${e instanceof Error ? e.message : String(e)})`,
    };
  }
  try {
    await mkdir(root, { recursive: true });
    await access(root, constants.W_OK);
  } catch (e) {
    return {
      ok: false,
      code: "backup-dir-unwritable",
      detail: `cannot write to ${root}: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const prefix = await detectServerPrefix();
  const worldRel = join("Saves", "Multiplayer", prefix);
  const worldAbs = join(dd, worldRel);
  if (!(await fileExists(worldAbs))) {
    return {
      ok: false,
      code: "world-missing",
      detail: `no world at ${worldAbs} (server maybe never booted)`,
    };
  }

  // Build tar arg list from what exists on disk — tar errors out on
  // missing paths, so probe each candidate first.
  const candidates = [
    worldRel,
    join("Server", `${prefix}.ini`),
    join("Server", `${prefix}_SandboxVars.lua`),
    join("Server", `${prefix}_spawnpoints.lua`),
    join("Server", `${prefix}_spawnregions.lua`),
    join("Server", `${prefix}.db`),
  ];
  const includes: string[] = [];
  for (const rel of candidates) {
    const abs = join(dd, rel);
    if (await fileExists(abs)) {
      if (!ensureUnder(dd, abs)) continue;
      includes.push(rel);
    }
  }
  if (includes.length === 0) {
    return {
      ok: false,
      code: "world-missing",
      detail: "no snapshot paths found under data dir",
    };
  }

  const stamp = isoStamp();
  const filename = `backup-${prefix}-${stamp}.tar.gz`;
  const outAbs = join(root, filename);

  // Execute: `tar -czf <outAbs> <includes…>` relative to data dir.
  const tarRes = await runTar(["-czf", outAbs, ...includes], dd);
  if (!tarRes.ok) {
    // Cleanup half-written tarball.
    await rm(outAbs, { force: true }).catch(() => {});
    return {
      ok: false,
      code: "tar-failed",
      detail: `tar exit ${tarRes.code}: ${tarRes.stderr.slice(0, 400)}`,
    };
  }
  const s = await stat(outAbs);

  const modCount = await prisma.mod
    .count({ where: { enabled: true } })
    .catch(() => 0);

  const row = await prisma.backup.create({
    data: {
      filename,
      sizeBytes: BigInt(s.size),
      kind: opts.kind,
      modCount,
      createdById: opts.userId ?? null,
      notes: opts.notes ?? null,
    },
  });

  const pruned = await pruneAutoBackups(opts.autoRetention ?? DEFAULT_AUTO_RETENTION);

  log().info(
    {
      filename,
      bytes: s.size,
      kind: opts.kind,
      pruned: pruned.length,
    },
    "backup created",
  );
  return { ok: true, row: toRow(row, true), pruned };
}

async function pruneAutoBackups(keep: number): Promise<string[]> {
  const autos = await prisma.backup.findMany({
    where: { kind: "AUTO" },
    orderBy: { createdAt: "desc" },
  });
  if (autos.length <= keep) return [];
  const toDrop = autos.slice(keep);
  const pruned: string[] = [];
  for (const b of toDrop) {
    const abs = join(backupRoot(), b.filename);
    if (!ensureUnder(backupRoot(), abs)) continue;
    await rm(abs, { force: true }).catch(() => {});
    await prisma.backup.delete({ where: { id: b.id } }).catch(() => {});
    pruned.push(b.filename);
  }
  return pruned;
}

export type DeleteFailure =
  | { ok: false; code: "not-found"; detail: string }
  | { ok: false; code: "unsafe-path"; detail: string };

export interface DeleteResult {
  ok: true;
  filename: string;
}

export async function deleteBackup(
  id: string,
): Promise<DeleteResult | DeleteFailure> {
  const row = await prisma.backup.findUnique({ where: { id } });
  if (!row) {
    return { ok: false, code: "not-found", detail: `no backup with id=${id}` };
  }
  const abs = join(backupRoot(), row.filename);
  if (!ensureUnder(backupRoot(), abs)) {
    return {
      ok: false,
      code: "unsafe-path",
      detail: `refusing to delete outside backup root: ${abs}`,
    };
  }
  await rm(abs, { force: true }).catch(() => {});
  await prisma.backup.delete({ where: { id } });
  return { ok: true, filename: row.filename };
}

export type RestoreFailure =
  | { ok: false; code: "not-found"; detail: string }
  | { ok: false; code: "server-running"; detail: string }
  | { ok: false; code: "tar-missing"; detail: string }
  | { ok: false; code: "tar-failed"; detail: string }
  | { ok: false; code: "data-dir-unreachable"; detail: string }
  | { ok: false; code: "unsafe-path"; detail: string };

export interface RestoreResult {
  ok: true;
  filename: string;
  preRestoreTrashed: Array<{ from: string; to: string }>;
}

export async function restoreBackup(args: {
  id: string;
  containerRunning: boolean;
  userId?: string | null;
}): Promise<RestoreResult | RestoreFailure> {
  if (args.containerRunning) {
    return {
      ok: false,
      code: "server-running",
      detail: "PZ container must be stopped before restoring",
    };
  }
  const row = await prisma.backup.findUnique({ where: { id: args.id } });
  if (!row) {
    return { ok: false, code: "not-found", detail: `no backup with id=${args.id}` };
  }
  const abs = join(backupRoot(), row.filename);
  if (!ensureUnder(backupRoot(), abs)) {
    return {
      ok: false,
      code: "unsafe-path",
      detail: `refusing to read outside backup root: ${abs}`,
    };
  }
  if (!(await fileExists(abs))) {
    return {
      ok: false,
      code: "tar-missing",
      detail: `tarball missing on disk: ${abs}`,
    };
  }
  const dd = dataDir();
  try {
    await stat(dd);
  } catch (e) {
    return {
      ok: false,
      code: "data-dir-unreachable",
      detail: `PZ_DATA_DIR not accessible: ${dd} (${e instanceof Error ? e.message : String(e)})`,
    };
  }

  // Trash the live world / configs before extracting. We don't know what's
  // in the tarball until we extract, but we know what PZ expects: current
  // save dir + the three Server/* config files. Rename them aside.
  const prefix = await detectServerPrefix();
  const stamp = isoStamp();
  const toTrash = [
    join("Saves", "Multiplayer", prefix),
    join("Server", `${prefix}.ini`),
    join("Server", `${prefix}_SandboxVars.lua`),
    join("Server", `${prefix}_spawnpoints.lua`),
    join("Server", `${prefix}_spawnregions.lua`),
    join("Server", `${prefix}.db`),
  ];
  const preRestoreTrashed: Array<{ from: string; to: string }> = [];
  for (const rel of toTrash) {
    const from = join(dd, rel);
    if (!(await fileExists(from))) continue;
    if (!ensureUnder(dd, from)) continue;
    const parent = dirname(from);
    const to = join(parent, `${basename(from)}.pre-restore-${stamp}`);
    try {
      await rename(from, to);
      preRestoreTrashed.push({ from, to });
    } catch (e) {
      log().warn(
        { from, to, err: e instanceof Error ? e.message : String(e) },
        "restore: pre-trash rename failed",
      );
    }
  }

  // Extract the tarball with -C dataDir.
  const res = await runTar(["-xzf", abs, "-C", dd], dd);
  if (!res.ok) {
    // Roll back the pre-trash renames so the server isn't left empty.
    for (const entry of preRestoreTrashed) {
      await rename(entry.to, entry.from).catch(() => {});
    }
    return {
      ok: false,
      code: "tar-failed",
      detail: `tar exit ${res.code}: ${res.stderr.slice(0, 400)}`,
    };
  }

  log().warn(
    {
      filename: row.filename,
      prefix,
      trashedCount: preRestoreTrashed.length,
    },
    "backup restored",
  );
  return { ok: true, filename: row.filename, preRestoreTrashed };
}

export async function streamBackup(
  id: string,
): Promise<
  | { ok: true; stream: NodeJS.ReadableStream; filename: string; sizeBytes: number }
  | DeleteFailure
> {
  const row = await prisma.backup.findUnique({ where: { id } });
  if (!row) {
    return { ok: false, code: "not-found", detail: `no backup with id=${id}` };
  }
  const abs = join(backupRoot(), row.filename);
  if (!ensureUnder(backupRoot(), abs)) {
    return {
      ok: false,
      code: "unsafe-path",
      detail: `refusing to stream outside backup root: ${abs}`,
    };
  }
  try {
    await stat(abs);
  } catch {
    return { ok: false, code: "not-found", detail: `tarball missing on disk: ${abs}` };
  }
  return {
    ok: true,
    stream: createReadStream(abs),
    filename: row.filename,
    sizeBytes: Number(row.sizeBytes),
  };
}

export function getBackupRoot(): string {
  return backupRoot();
}
