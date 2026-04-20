import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("writer FS error handling", () => {
  let root: string;
  let serverDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "pz-w-"));
    serverDir = join(root, "Server");
    await mkdir(serverDir, { recursive: true });
    process.env.PZ_CONFIG_DIR = serverDir;
    process.env.PZ_BACKUP_DIR = join(serverDir, ".backups");
    process.env.PZ_SERVER_PREFIX = "servertest";
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    delete process.env.PZ_CONFIG_DIR;
    delete process.env.PZ_BACKUP_DIR;
    delete process.env.PZ_SERVER_PREFIX;
    vi.resetModules();
    vi.unmock("@/lib/pz/access-check");
  });

  it("surfaces config-dir-unreachable when access-check reports false", async () => {
    vi.resetModules();
    vi.doMock("@/lib/pz/access-check", () => ({
      getConfigAccessOk: () => false,
      checkConfigAccess: async () => ({ ok: false, dir: "", reason: "ENOENT" }),
    }));
    const { writeServerIni } = await import("@/lib/pz/writer");
    const r = await writeServerIni({ MaxPlayers: 9 }, { clientMtimeMs: Date.now() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("config-dir-unreachable");
  });

  it("surfaces io when the config file is missing (server.ini)", async () => {
    vi.resetModules();
    vi.doMock("@/lib/pz/access-check", () => ({
      getConfigAccessOk: () => true,
      checkConfigAccess: async () => ({ ok: true, dir: "" }),
    }));
    const { writeServerIni } = await import("@/lib/pz/writer");
    const r = await writeServerIni({ MaxPlayers: 9 }, { clientMtimeMs: Date.now() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("io");
  });

  it("surfaces io when the sandbox file is missing", async () => {
    vi.resetModules();
    vi.doMock("@/lib/pz/access-check", () => ({
      getConfigAccessOk: () => true,
      checkConfigAccess: async () => ({ ok: true, dir: "" }),
    }));
    const { writeSandboxVars } = await import("@/lib/pz/writer");
    const r = await writeSandboxVars(
      { FoodLootNew: 1 },
      { clientMtimeMs: Date.now() },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("io");
  });

  it("file under the configured prefix exists → succeeds", async () => {
    vi.resetModules();
    vi.doMock("@/lib/pz/access-check", () => ({
      getConfigAccessOk: () => true,
      checkConfigAccess: async () => ({ ok: true, dir: "" }),
    }));
    const iniPath = join(serverDir, "servertest.ini");
    await writeFile(iniPath, "MaxPlayers=8\n");
    const { mtimeMs } = await stat(iniPath);
    const { writeServerIni } = await import("@/lib/pz/writer");
    const r = await writeServerIni({ MaxPlayers: 9 }, { clientMtimeMs: mtimeMs });
    expect(r.ok).toBe(true);
  });
});
