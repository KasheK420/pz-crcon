/**
 * Config-file snapshot + restore used by the lifecycle orchestrator.
 *
 * Why this exists: Project Zomboid loads `<prefix>.ini` and
 * `<prefix>_SandboxVars.lua` into memory at startup and re-persists
 * them back to disk on `save` / `quit` / graceful shutdown. That means
 * an FS-level edit we make while the server is running is silently
 * reverted the moment a graceful restart pipeline sends RCON `save`
 * (the engine overwrites the files with its stale in-memory values).
 *
 * The fix is to wrap the stop phase of `gracefulRestart()` with:
 *
 *   const snap = await snapshotPzConfig();
 *   …save → quit → stop…
 *   await restorePzConfig(snap);
 *   …start…
 *
 * We snapshot *after* the user edit has already landed on disk (i.e.
 * the raw content reflects the admin's intent). We restore *before*
 * the start phase so the next boot reads our values, not the engine's
 * shutdown writeback.
 *
 * Restore is intentionally dumb: byte-for-byte overwrite, atomic
 * rename, no mtime or lifecycle gating (the lifecycle mutex already
 * guarantees exclusivity). Falls back gracefully when a file was
 * missing at snapshot time — we don't create files the user hadn't
 * asked us to manage.
 */

import { randomBytes } from "node:crypto";
import { open, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { getLogger } from "@/lib/logger";
import { detectServerPrefix } from "./config-reader";

const log = () => getLogger().child({ mod: "pz/snapshot" });

const configDir = (): string => process.env.PZ_CONFIG_DIR ?? "/pz-data/Server";

export interface PzConfigSnapshot {
  prefix: string;
  ini?: { path: string; raw: string; mtimeMs: number };
  sandbox?: { path: string; raw: string; mtimeMs: number };
}

async function readIfExists(
  path: string,
): Promise<{ raw: string; mtimeMs: number } | undefined> {
  try {
    const raw = await readFile(path, "utf8");
    const s = await stat(path);
    return { raw, mtimeMs: s.mtimeMs };
  } catch (e) {
    log().debug(
      { path, err: e instanceof Error ? e.message : String(e) },
      "snapshot: file missing or unreadable, skipping",
    );
    return undefined;
  }
}

export async function snapshotPzConfig(): Promise<PzConfigSnapshot> {
  const prefix = await detectServerPrefix();
  const iniPath = join(configDir(), `${prefix}.ini`);
  const sbxPath = join(configDir(), `${prefix}_SandboxVars.lua`);
  const [ini, sandbox] = await Promise.all([
    readIfExists(iniPath),
    readIfExists(sbxPath),
  ]);
  const snap: PzConfigSnapshot = { prefix };
  if (ini) snap.ini = { path: iniPath, ...ini };
  if (sandbox) snap.sandbox = { path: sbxPath, ...sandbox };
  log().info(
    {
      prefix,
      hasIni: !!snap.ini,
      hasSandbox: !!snap.sandbox,
      iniBytes: snap.ini?.raw.length,
      sandboxBytes: snap.sandbox?.raw.length,
    },
    "config snapshot captured",
  );
  return snap;
}

async function atomicOverwrite(path: string, content: string): Promise<number> {
  const tmp = join(
    dirname(path),
    `.${basename(path)}.tmp-${randomBytes(6).toString("hex")}`,
  );
  await writeFile(tmp, content, "utf8");
  const fh = await open(tmp, "r+");
  try {
    await fh.sync();
  } finally {
    await fh.close();
  }
  await rename(tmp, path);
  const s = await stat(path);
  return s.mtimeMs;
}

export interface RestoreOutcome {
  ini?: { clobbered: boolean; restoredMtimeMs: number };
  sandbox?: { clobbered: boolean; restoredMtimeMs: number };
}

/**
 * Restore a snapshot taken earlier. For each file:
 *  - if disk content differs from the snapshot (PZ clobbered it on
 *    shutdown), atomically overwrite with the snapshot bytes.
 *  - if disk already matches the snapshot, skip (no pointless write).
 *
 * Never throws on a single-file failure; logs and continues so that a
 * failed ini restore doesn't block the sandbox restore (and vice
 * versa). The caller inspects the returned outcome.
 */
export async function restorePzConfig(
  snap: PzConfigSnapshot,
): Promise<RestoreOutcome> {
  const out: RestoreOutcome = {};
  if (snap.ini) {
    try {
      const current = await readFile(snap.ini.path, "utf8").catch(() => "");
      if (current === snap.ini.raw) {
        log().info({ path: snap.ini.path }, "restore: ini unchanged, skipping");
        out.ini = { clobbered: false, restoredMtimeMs: snap.ini.mtimeMs };
      } else {
        const m = await atomicOverwrite(snap.ini.path, snap.ini.raw);
        log().warn(
          {
            path: snap.ini.path,
            diskBytes: current.length,
            snapBytes: snap.ini.raw.length,
          },
          "restore: ini was clobbered by PZ, restored from snapshot",
        );
        out.ini = { clobbered: true, restoredMtimeMs: m };
      }
    } catch (e) {
      log().error(
        { path: snap.ini.path, err: e instanceof Error ? e.message : String(e) },
        "restore: ini restore failed",
      );
    }
  }
  if (snap.sandbox) {
    try {
      const current = await readFile(snap.sandbox.path, "utf8").catch(() => "");
      if (current === snap.sandbox.raw) {
        log().info(
          { path: snap.sandbox.path },
          "restore: sandbox unchanged, skipping",
        );
        out.sandbox = { clobbered: false, restoredMtimeMs: snap.sandbox.mtimeMs };
      } else {
        const m = await atomicOverwrite(snap.sandbox.path, snap.sandbox.raw);
        log().warn(
          {
            path: snap.sandbox.path,
            diskBytes: current.length,
            snapBytes: snap.sandbox.raw.length,
          },
          "restore: sandbox was clobbered by PZ, restored from snapshot",
        );
        out.sandbox = { clobbered: true, restoredMtimeMs: m };
      }
    } catch (e) {
      log().error(
        {
          path: snap.sandbox.path,
          err: e instanceof Error ? e.message : String(e),
        },
        "restore: sandbox restore failed",
      );
    }
  }
  return out;
}
