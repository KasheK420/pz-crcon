import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readServerIni, readSandboxVars } from "@/lib/pz/config-reader";

describe("config-reader (fs path)", () => {
  let dir: string;
  let serverDir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pz-cr-"));
    serverDir = join(dir, "Server");
    await mkdir(serverDir, { recursive: true });
    process.env.PZ_CONFIG_DIR = serverDir;
    process.env.PZ_SERVER_PREFIX = "servertest";
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    delete process.env.PZ_CONFIG_DIR;
    delete process.env.PZ_SERVER_PREFIX;
  });

  it("reads ini from FS", async () => {
    await writeFile(join(serverDir, "servertest.ini"), "Open=true\nMaxPlayers=8\n");
    const r = await readServerIni();
    expect(r.ok).toBe(true);
    expect(r.parsed?.entries.find((e) => e.key === "Open")?.value).toBe("true");
  });

  it("returns ok:false when file missing", async () => {
    const r = await readServerIni();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ENOENT|not found/i);
  });

  it("reads sandbox from FS", async () => {
    const lua = `SandboxVars = {\n  VERSION = 5,\n  Zombies = {\n    Speed = 4,\n  },\n}\n`;
    await writeFile(join(serverDir, "servertest_SandboxVars.lua"), lua);
    const r = await readSandboxVars();
    expect(r.ok).toBe(true);
    expect(r.parsed?.flat["Zombies.Speed"]).toBe(4);
  });
});
