/**
 * Unit tests for `lib/pz/world-reset.ts`.
 *
 * We stage a fake `pz-data` layout under a tempdir (Server/, Saves/,
 * and a fake <prefix>.db file), then exercise `wipeWorld` for each
 * mode and verify:
 *
 *   - "world" mode only trashes Saves/Multiplayer/<prefix>/; Server/
 *     and Saves/Multiplayer/ itself survive.
 *   - "total-nuke" trashes Saves/ and <prefix>.db; Server/.ini does
 *     not.
 *   - Targets are renamed to `.trash-<isoStamp>` siblings — nothing is
 *     removed with `rm -rf` in the success path.
 *   - After `TRASH_RETENTION` wipes, the oldest trash is pruned.
 *   - Running the wipe while containerRunning=true is refused.
 *   - Unsafe prefixes (path traversal) are refused before any rename.
 */

import {
  mkdir,
  mkdtemp,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({
  getLogger: () => ({
    child: () => ({
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    }),
  }),
}));

let detectedPrefix = "MajorlukPZ";

vi.mock("@/lib/pz/config-reader", () => ({
  detectServerPrefix: async () => detectedPrefix,
}));

let tmp: string;

async function stage(prefix: string) {
  await mkdir(join(tmp, "Server"), { recursive: true });
  await writeFile(
    join(tmp, "Server", `${prefix}.ini`),
    "Mods=\nMap=Muldraugh, KY\n",
    "utf8",
  );
  await writeFile(
    join(tmp, "Server", `${prefix}_SandboxVars.lua`),
    "SandboxVars = {\n}\n",
    "utf8",
  );
  await writeFile(
    join(tmp, "Server", `${prefix}.db`),
    "fake-sqlite-bytes",
    "utf8",
  );
  await mkdir(join(tmp, "Saves", "Multiplayer", prefix), {
    recursive: true,
  });
  await writeFile(
    join(tmp, "Saves", "Multiplayer", prefix, "map_t.bin"),
    "chunkdata",
    "utf8",
  );
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pz-reset-"));
  process.env.PZ_DATA_DIR = tmp;
  detectedPrefix = "MajorlukPZ";
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
  delete process.env.PZ_DATA_DIR;
  vi.resetModules();
});

describe("wipeWorld — world mode", () => {
  it("trashes Saves/Multiplayer/<prefix> and leaves config + user DB intact", async () => {
    await stage("MajorlukPZ");
    const { wipeWorld } = await import("@/lib/pz/world-reset");
    const r = await wipeWorld({ mode: "world", containerRunning: false });
    if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.detail}`);

    const worldDir = join(tmp, "Saves", "Multiplayer", "MajorlukPZ");
    expect(await pathExists(worldDir)).toBe(false);

    // Trash sibling should exist
    const entries = await readdir(join(tmp, "Saves", "Multiplayer"));
    const trash = entries.find((e) => e.startsWith("MajorlukPZ.trash-"));
    expect(trash).toBeDefined();

    // Config + user DB untouched
    expect(
      await pathExists(join(tmp, "Server", "MajorlukPZ.ini")),
    ).toBe(true);
    expect(
      await pathExists(join(tmp, "Server", "MajorlukPZ.db")),
    ).toBe(true);
  });

  it("is idempotent when the world folder is already missing", async () => {
    await mkdir(join(tmp, "Server"), { recursive: true });
    await writeFile(join(tmp, "Server", "MajorlukPZ.ini"), "Mods=\n", "utf8");

    const { wipeWorld } = await import("@/lib/pz/world-reset");
    const r = await wipeWorld({ mode: "world", containerRunning: false });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.trashed).toHaveLength(0);
  });
});

describe("wipeWorld — total-nuke mode", () => {
  it("trashes both Saves/ and <prefix>.db; keeps .ini / .lua", async () => {
    await stage("MajorlukPZ");
    const { wipeWorld } = await import("@/lib/pz/world-reset");
    const r = await wipeWorld({
      mode: "total-nuke",
      containerRunning: false,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(await pathExists(join(tmp, "Saves"))).toBe(false);
    expect(
      await pathExists(join(tmp, "Server", "MajorlukPZ.db")),
    ).toBe(false);

    // Sibling trash directories
    const rootEntries = await readdir(tmp);
    expect(rootEntries.some((e) => e.startsWith("Saves.trash-"))).toBe(true);
    const serverEntries = await readdir(join(tmp, "Server"));
    expect(
      serverEntries.some((e) => e.startsWith("MajorlukPZ.db.trash-")),
    ).toBe(true);

    // Config survives
    expect(
      await pathExists(join(tmp, "Server", "MajorlukPZ.ini")),
    ).toBe(true);
    expect(
      await pathExists(join(tmp, "Server", "MajorlukPZ_SandboxVars.lua")),
    ).toBe(true);

    expect(r.trashed.length).toBeGreaterThanOrEqual(2);
  });
});

describe("wipeWorld — safety", () => {
  it("refuses when containerRunning=true", async () => {
    await stage("MajorlukPZ");
    const { wipeWorld } = await import("@/lib/pz/world-reset");
    const r = await wipeWorld({ mode: "world", containerRunning: true });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("server-still-running");

    // Nothing was trashed.
    const entries = await readdir(join(tmp, "Saves", "Multiplayer"));
    expect(entries.some((e) => e.includes(".trash-"))).toBe(false);
  });

  it("refuses an unsafe prefix (path traversal)", async () => {
    await stage("MajorlukPZ");
    detectedPrefix = "../../../etc/passwd";
    const { wipeWorld } = await import("@/lib/pz/world-reset");
    const r = await wipeWorld({ mode: "world", containerRunning: false });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("prefix-unsafe");
  });

  it("refuses when data dir is unreachable", async () => {
    process.env.PZ_DATA_DIR = join(tmp, "nope-does-not-exist");
    const { wipeWorld } = await import("@/lib/pz/world-reset");
    const r = await wipeWorld({ mode: "world", containerRunning: false });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("data-dir-unreachable");
  });
});

describe("wipeWorld — trash retention", () => {
  it("keeps the last 3 trash entries and prunes the oldest", async () => {
    const { wipeWorld } = await import("@/lib/pz/world-reset");
    // Four successive wipes. Recreate the world between each.
    for (let i = 0; i < 4; i++) {
      await mkdir(join(tmp, "Saves", "Multiplayer", "MajorlukPZ"), {
        recursive: true,
      });
      await writeFile(
        join(tmp, "Saves", "Multiplayer", "MajorlukPZ", "chunk.bin"),
        `gen-${i}`,
        "utf8",
      );
      // The isoStamp is second-precision; bump the clock to avoid
      // collisions when tests run fast.
      await new Promise((r) => setTimeout(r, 1100));
      const r = await wipeWorld({
        mode: "world",
        containerRunning: false,
      });
      expect(r.ok).toBe(true);
    }
    const entries = await readdir(join(tmp, "Saves", "Multiplayer"));
    const trashes = entries.filter((e) => e.startsWith("MajorlukPZ.trash-"));
    expect(trashes.length).toBe(3);
  }, 15_000);
});
