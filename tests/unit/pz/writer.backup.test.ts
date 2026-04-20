import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, readdir, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("@/lib/pz/access-check", () => ({
  getConfigAccessOk: () => true,
  checkConfigAccess: async () => ({ ok: true, dir: "" }),
}));

const { writeServerIni } = await import("@/lib/pz/writer");

describe("writer backup retention", () => {
  let root: string;
  let serverDir: string;
  let backupsDir: string;
  let iniPath: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "pz-w-"));
    serverDir = join(root, "Server");
    backupsDir = join(serverDir, ".backups");
    await mkdir(serverDir, { recursive: true });
    process.env.PZ_CONFIG_DIR = serverDir;
    process.env.PZ_BACKUP_DIR = backupsDir;
    process.env.PZ_SERVER_PREFIX = "servertest";
    iniPath = join(serverDir, "servertest.ini");
    await writeFile(iniPath, "MaxPlayers=8\n");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    delete process.env.PZ_CONFIG_DIR;
    delete process.env.PZ_BACKUP_DIR;
    delete process.env.PZ_SERVER_PREFIX;
  });

  it("creates one backup per write, named with ISO timestamp", async () => {
    const { mtimeMs } = await stat(iniPath);
    const r = await writeServerIni({ MaxPlayers: 9 }, { clientMtimeMs: mtimeMs });
    expect(r.ok).toBe(true);
    const files = await readdir(backupsDir);
    const mine = files.filter((f) => f.startsWith("servertest.ini.bak-"));
    expect(mine.length).toBe(1);
  });

  it("prunes to the newest 10 backups when more accumulate", async () => {
    // Do 15 writes; each creates one backup.
    for (let i = 1; i <= 15; i++) {
      const { mtimeMs } = await stat(iniPath);
      const r = await writeServerIni(
        { MaxPlayers: i + 1 },
        { clientMtimeMs: mtimeMs },
      );
      expect(r.ok).toBe(true);
      // ISO timestamps have millisecond resolution; writes are fast — insert
      // a tiny wait so each backup filename is unique.
      await new Promise((res) => setTimeout(res, 5));
    }
    const files = (await readdir(backupsDir)).filter((f) =>
      f.startsWith("servertest.ini.bak-"),
    );
    expect(files.length).toBe(10);
    // They should be the 10 newest, which (lexicographic ISO) means the 10
    // greatest by string sort.
    const sorted = [...files].sort();
    expect(sorted).toEqual(files.sort());
  });
});
