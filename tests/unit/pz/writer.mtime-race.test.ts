import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("@/lib/pz/access-check", () => ({
  getConfigAccessOk: () => true,
  checkConfigAccess: async () => ({ ok: true, dir: "" }),
}));

const { writeServerIni } = await import("@/lib/pz/writer");

describe("writer mtime race", () => {
  let root: string;
  let serverDir: string;
  let iniPath: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "pz-w-"));
    serverDir = join(root, "Server");
    await mkdir(serverDir, { recursive: true });
    process.env.PZ_CONFIG_DIR = serverDir;
    process.env.PZ_BACKUP_DIR = join(serverDir, ".backups");
    process.env.PZ_SERVER_PREFIX = "servertest";
    iniPath = join(serverDir, "servertest.ini");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    delete process.env.PZ_CONFIG_DIR;
    delete process.env.PZ_BACKUP_DIR;
    delete process.env.PZ_SERVER_PREFIX;
  });

  it("rejects write when clientMtimeMs disagrees with disk mtime", async () => {
    await writeFile(iniPath, "MaxPlayers=16\n");
    const { mtimeMs } = await stat(iniPath);

    // Simulate a stale client by providing a wildly wrong mtime.
    const r = await writeServerIni({ MaxPlayers: 8 }, { clientMtimeMs: mtimeMs - 10_000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("mtime-race");

    // File contents unchanged.
    expect(await readFile(iniPath, "utf8")).toBe("MaxPlayers=16\n");
  });

  it("accepts matching mtime (second-resolution tolerance)", async () => {
    await writeFile(iniPath, "MaxPlayers=16\n");
    const { mtimeMs } = await stat(iniPath);
    // Off by < 1s — still same floor-second → should pass.
    const r = await writeServerIni(
      { MaxPlayers: 8 },
      { clientMtimeMs: mtimeMs + 500 },
    );
    expect(r.ok).toBe(true);
  });
});
