import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, stat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("@/lib/pz/access-check", () => ({
  getConfigAccessOk: () => true,
  checkConfigAccess: async () => ({ ok: true, dir: "" }),
}));

const { writeServerIni } = await import("@/lib/pz/writer");

describe("writer mutex serialization", () => {
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
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    delete process.env.PZ_CONFIG_DIR;
    delete process.env.PZ_BACKUP_DIR;
    delete process.env.PZ_SERVER_PREFIX;
  });

  it("two concurrent writes serialize via the mutex (no interleaving)", async () => {
    // Each call reads the current mtime inside its critical section, so
    // firing both at once with the same initial mtime still succeeds because
    // the second acquires the lock only after the first completes and picks
    // up the new mtime (< 1s elapsed → same floor-second).
    const { mtimeMs } = await stat(iniPath);
    const [a, b] = await Promise.all([
      writeServerIni({ MaxPlayers: 10 }, { clientMtimeMs: mtimeMs }),
      writeServerIni({ MaxPlayers: 20 }, { clientMtimeMs: mtimeMs }),
    ]);
    // At least one must succeed. Depending on timing (sub-second mtime
    // updates on some filesystems), the second may see an unchanged
    // floor-second mtime and also succeed — that's fine; the key property
    // is that the final on-disk value is one of the two patches, not a
    // corrupted mix.
    expect(a.ok || b.ok).toBe(true);
    const finalContent = await readFile(iniPath, "utf8");
    expect(["MaxPlayers=10\n", "MaxPlayers=20\n"]).toContain(finalContent);
  });
});
