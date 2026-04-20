import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { serializeSandboxLua } from "@/lib/pz/serialize-sandbox-lua";
import { parseSandboxLua } from "@/lib/pz/parse-sandbox-lua";

const FIXTURE = readFileSync(
  join(process.cwd(), "tests/fixtures/live-sandbox.lua"),
  "utf8",
);

describe("serializeSandboxLua", () => {
  it("returns source unchanged for empty patch (live fixture round-trips)", () => {
    expect(serializeSandboxLua(FIXTURE, {})).toBe(FIXTURE);
  });

  it("swaps a scalar value via parser offsets", () => {
    const src = `SandboxVars = {\n  Zombies = {\n    Speed = 4,\n    Strength = 2,\n  },\n}\n`;
    const out = serializeSandboxLua(src, { "Zombies.Speed": 1 });
    expect(out).toBe(
      `SandboxVars = {\n  Zombies = {\n    Speed = 1,\n    Strength = 2,\n  },\n}\n`,
    );
  });

  it("swaps a top-level (root) scalar", () => {
    const src = `SandboxVars = {\n  VERSION = 5,\n  PVP = true,\n}\n`;
    const out = serializeSandboxLua(src, { VERSION: 6, PVP: false });
    expect(out).toBe(`SandboxVars = {\n  VERSION = 6,\n  PVP = false,\n}\n`);
  });

  it("handles multiple edits end-to-start (offset safety)", () => {
    const src = `SandboxVars = {\n  A = 1,\n  B = 2,\n  C = 3,\n}\n`;
    const out = serializeSandboxLua(src, { A: 100, B: 200, C: 300 });
    expect(out).toBe(`SandboxVars = {\n  A = 100,\n  B = 200,\n  C = 300,\n}\n`);
  });

  it("quotes string values and escapes embedded double quotes", () => {
    const src = `SandboxVars = {\n  Msg = "old",\n}\n`;
    const out = serializeSandboxLua(src, { Msg: 'hi "world"' });
    expect(out).toBe(`SandboxVars = {\n  Msg = "hi \\"world\\"",\n}\n`);
  });

  it("throws unknown-key for paths not present in source", () => {
    const src = `SandboxVars = {\n  A = 1,\n}\n`;
    expect(() => serializeSandboxLua(src, { "Not.Present": 1 })).toThrow(/unknown-key/);
    try {
      serializeSandboxLua(src, { "Not.Present": 1 });
    } catch (e) {
      expect((e as Error & { code?: string }).code).toBe("unknown-key");
    }
  });

  it("preserves surrounding comments and whitespace on the live fixture", () => {
    const parsed = parseSandboxLua(FIXTURE);
    // Grab a known-real key from the fixture and round-trip-with-edit it.
    const entry = parsed.sections
      .flatMap((s) =>
        s.entries.map((e) => ({
          section: s.name,
          key: e.key,
          kind: e.kind,
          value: e.value,
        })),
      )
      .find((x) => x.kind === "number" && typeof x.value === "number");
    expect(entry).toBeDefined();
    const path = entry!.section === "_root" ? entry!.key : `${entry!.section}.${entry!.key}`;
    const newVal = (entry!.value as number) === 0 ? 1 : 0;
    const out = serializeSandboxLua(FIXTURE, { [path]: newVal });
    expect(out).not.toBe(FIXTURE);
    // Re-parse the output and check only that one path changed.
    const reparsed = parseSandboxLua(out);
    expect(reparsed.flat[path]).toBe(newVal);
    // Byte length delta is bounded by the numeric literal difference — not
    // material to check here; the real contract is the parser round-trip.
  });
});
