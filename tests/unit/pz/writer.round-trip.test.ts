import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Bypass the real access-check; tests run with a real (ephemeral) FS.
vi.mock("@/lib/pz/access-check", () => ({
  getConfigAccessOk: () => true,
  checkConfigAccess: async () => ({ ok: true, dir: "" }),
}));

// Import AFTER vi.mock so the mock is applied.
const { writeServerIni, writeSandboxVars } = await import("@/lib/pz/writer");

describe("writer round-trip", () => {
  let root: string;
  let serverDir: string;
  let backupsDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "pz-w-"));
    serverDir = join(root, "Server");
    backupsDir = join(serverDir, ".backups");
    await mkdir(serverDir, { recursive: true });
    process.env.PZ_CONFIG_DIR = serverDir;
    process.env.PZ_BACKUP_DIR = backupsDir;
    process.env.PZ_SERVER_PREFIX = "servertest";
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    delete process.env.PZ_CONFIG_DIR;
    delete process.env.PZ_BACKUP_DIR;
    delete process.env.PZ_SERVER_PREFIX;
  });

  it("server.ini: happy-path write updates the value on disk", async () => {
    const path = join(serverDir, "servertest.ini");
    const original = "Open=false\nMaxPlayers=16\n";
    await writeFile(path, original);
    const { mtimeMs } = await stat(path);

    const r = await writeServerIni({ Open: true }, { clientMtimeMs: mtimeMs });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.diff).toEqual([{ path: "Open", from: "false", to: true }]);
      expect(r.newMtimeMs).toBeGreaterThanOrEqual(mtimeMs);
      expect(r.backupPath).toContain(".backups");
    }

    const after = await readFile(path, "utf8");
    expect(after).toBe("Open=true\nMaxPlayers=16\n");
  });

  it("sandbox: happy-path write updates the scalar via offset splice", async () => {
    const path = join(serverDir, "servertest_SandboxVars.lua");
    const original = `SandboxVars = {\n  ZombieVoronoiNoise = true,\n}\n`;
    await writeFile(path, original);
    const { mtimeMs } = await stat(path);

    const r = await writeSandboxVars(
      { ZombieVoronoiNoise: false },
      { clientMtimeMs: mtimeMs },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.diff).toEqual([{ path: "ZombieVoronoiNoise", from: true, to: false }]);
    }

    const after = await readFile(path, "utf8");
    expect(after).toBe(`SandboxVars = {\n  ZombieVoronoiNoise = false,\n}\n`);
  });

  it("empty patch is rejected early without FS access", async () => {
    const r = await writeServerIni({}, { clientMtimeMs: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("empty-patch");
  });

  it("validation failure does not write to disk", async () => {
    const path = join(serverDir, "servertest.ini");
    const original = "MaxPlayers=16\n";
    await writeFile(path, original);
    const { mtimeMs } = await stat(path);

    // MaxPlayers max is 100 in descriptors → 9999 fails validation.
    const r = await writeServerIni({ MaxPlayers: 9999 }, { clientMtimeMs: mtimeMs });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("validation");
      expect(r.errors?.[0].path).toBe("MaxPlayers");
    }
    expect(await readFile(path, "utf8")).toBe(original);
  });

  it("unknown sandbox key fails with unknown-key code", async () => {
    const path = join(serverDir, "servertest_SandboxVars.lua");
    const original = `SandboxVars = {\n  ZombieVoronoiNoise = true,\n}\n`;
    await writeFile(path, original);
    const { mtimeMs } = await stat(path);

    // This passes descriptor validation (it exists) but is not in the source.
    const r = await writeSandboxVars(
      { FoodLootNew: 1.5 },
      { clientMtimeMs: mtimeMs },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("unknown-key");
    expect(await readFile(path, "utf8")).toBe(original);
  });
});
