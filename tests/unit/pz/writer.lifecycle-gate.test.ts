import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, stat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("@/lib/pz/access-check", () => ({
  getConfigAccessOk: () => true,
  checkConfigAccess: async () => ({ ok: true, dir: "" }),
}));

const { writeServerIni, registerLifecyclePhaseGetter, __resetLifecyclePhaseGetterForTests } =
  await import("@/lib/pz/writer");

describe("writer lifecycle gate", () => {
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
    await writeFile(iniPath, "MaxPlayers=8\n");
    __resetLifecyclePhaseGetterForTests();
  });

  afterEach(async () => {
    __resetLifecyclePhaseGetterForTests();
    await rm(root, { recursive: true, force: true });
    delete process.env.PZ_CONFIG_DIR;
    delete process.env.PZ_BACKUP_DIR;
    delete process.env.PZ_SERVER_PREFIX;
  });

  it("rejects write when lifecycle phase is not 'idle'", async () => {
    registerLifecyclePhaseGetter(() => "starting");
    const { mtimeMs } = await stat(iniPath);
    const r = await writeServerIni({ MaxPlayers: 9 }, { clientMtimeMs: mtimeMs });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("lifecycle-busy");
      expect(r.detail).toContain("starting");
    }
    expect(await readFile(iniPath, "utf8")).toBe("MaxPlayers=8\n");
  });

  it("permits write when phase returns to 'idle'", async () => {
    registerLifecyclePhaseGetter(() => "idle");
    const { mtimeMs } = await stat(iniPath);
    const r = await writeServerIni({ MaxPlayers: 9 }, { clientMtimeMs: mtimeMs });
    expect(r.ok).toBe(true);
  });
});
