/**
 * Unit tests for `lib/pz/snapshot.ts`.
 *
 * We stage `.ini` and `_SandboxVars.lua` files inside a tempdir, then
 * verify that:
 *   - `snapshotPzConfig()` captures the current bytes and mtime.
 *   - `restorePzConfig()` is a no-op when disk already matches.
 *   - `restorePzConfig()` atomically overwrites when disk has been
 *     mutated between snapshot and restore (simulating PZ writing its
 *     stale in-memory values back on shutdown).
 *   - A missing file at snapshot time is gracefully skipped and not
 *     re-created at restore time (we don't invent files we weren't
 *     asked to manage).
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

vi.mock("@/lib/pz/config-reader", () => ({
  detectServerPrefix: async () => "TestServer",
}));

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pz-snap-"));
  process.env.PZ_CONFIG_DIR = tmp;
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
  delete process.env.PZ_CONFIG_DIR;
  vi.resetModules();
});

describe("snapshotPzConfig / restorePzConfig", () => {
  it("captures both files when present and restores byte-identical content", async () => {
    const iniPath = join(tmp, "TestServer.ini");
    const sbxPath = join(tmp, "TestServer_SandboxVars.lua");
    const iniOriginal = "Mods=coolmod\nMap=Muldraugh, KY\n";
    const sbxOriginal = "SandboxVars = {\n  Zombies = 3,\n}\n";
    await writeFile(iniPath, iniOriginal, "utf8");
    await writeFile(sbxPath, sbxOriginal, "utf8");

    const { snapshotPzConfig, restorePzConfig } = await import(
      "@/lib/pz/snapshot"
    );

    const snap = await snapshotPzConfig();
    expect(snap.prefix).toBe("TestServer");
    expect(snap.ini?.raw).toBe(iniOriginal);
    expect(snap.sandbox?.raw).toBe(sbxOriginal);

    // Simulate PZ overwriting both files with stale in-memory state.
    await writeFile(iniPath, "Mods=\nMap=Muldraugh, KY\n", "utf8");
    await writeFile(sbxPath, "SandboxVars = {\n  Zombies = 1,\n}\n", "utf8");

    const out = await restorePzConfig(snap);
    expect(out.ini?.clobbered).toBe(true);
    expect(out.sandbox?.clobbered).toBe(true);

    const iniAfter = await readFile(iniPath, "utf8");
    const sbxAfter = await readFile(sbxPath, "utf8");
    expect(iniAfter).toBe(iniOriginal);
    expect(sbxAfter).toBe(sbxOriginal);
  });

  it("skips restore when disk already matches the snapshot", async () => {
    const iniPath = join(tmp, "TestServer.ini");
    await writeFile(iniPath, "Mods=cool\n", "utf8");

    const { snapshotPzConfig, restorePzConfig } = await import(
      "@/lib/pz/snapshot"
    );
    const snap = await snapshotPzConfig();
    const out = await restorePzConfig(snap);
    expect(out.ini?.clobbered).toBe(false);
    const iniAfter = await readFile(iniPath, "utf8");
    expect(iniAfter).toBe("Mods=cool\n");
  });

  it("gracefully handles a missing file at snapshot time", async () => {
    // Only create the ini; sandbox file absent.
    await writeFile(join(tmp, "TestServer.ini"), "Mods=cool\n", "utf8");

    const { snapshotPzConfig, restorePzConfig } = await import(
      "@/lib/pz/snapshot"
    );
    const snap = await snapshotPzConfig();
    expect(snap.ini).toBeDefined();
    expect(snap.sandbox).toBeUndefined();

    const out = await restorePzConfig(snap);
    expect(out.sandbox).toBeUndefined();
    expect(out.ini?.clobbered).toBe(false);
  });

  it("does not recreate files that didn't exist at snapshot time", async () => {
    // Neither file exists at snapshot time.
    await mkdir(tmp, { recursive: true });

    const { snapshotPzConfig, restorePzConfig } = await import(
      "@/lib/pz/snapshot"
    );
    const snap = await snapshotPzConfig();
    expect(snap.ini).toBeUndefined();
    expect(snap.sandbox).toBeUndefined();

    await restorePzConfig(snap);
    // Confirm restore did not conjure files out of thin air.
    await expect(
      readFile(join(tmp, "TestServer.ini"), "utf8"),
    ).rejects.toThrow();
    await expect(
      readFile(join(tmp, "TestServer_SandboxVars.lua"), "utf8"),
    ).rejects.toThrow();
  });
});
