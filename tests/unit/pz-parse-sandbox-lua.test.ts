import { describe, expect, it } from "vitest";
import { parseSandboxLua } from "@/lib/pz/parse-sandbox-lua";

const SAMPLE = `
SandboxVars = {
    VERSION = 5,
    Population = {
        PopulationMultiplier = 1.4,
        PopulationStartMultiplier = 1.0,
        RespawnMultiplier = 0.5,
    },
    Weather = {
        StartMonth = 7,
        Temperature = 2,
    },
    PVP = true,
    ServerWelcomeMessage = "Welcome",
}
`;

describe("parseSandboxLua", () => {
  it("extracts top-level scalars into _root", () => {
    const r = parseSandboxLua(SAMPLE);
    const root = r.sections.find((s) => s.name === "_root");
    expect(root).toBeDefined();
    expect(root?.entries.find((e) => e.key === "VERSION")?.value).toBe(5);
    expect(root?.entries.find((e) => e.key === "PVP")?.value).toBe(true);
    expect(root?.entries.find((e) => e.key === "ServerWelcomeMessage")?.value).toBe("Welcome");
  });

  it("extracts nested tables as named sections", () => {
    const r = parseSandboxLua(SAMPLE);
    const pop = r.sections.find((s) => s.name === "Population");
    expect(pop).toBeDefined();
    expect(pop?.entries).toHaveLength(3);
    expect(pop?.entries.find((e) => e.key === "PopulationMultiplier")?.value).toBeCloseTo(1.4);
  });

  it("classifies number/string/boolean kinds", () => {
    const r = parseSandboxLua(SAMPLE);
    const root = r.sections.find((s) => s.name === "_root");
    const ver = root?.entries.find((e) => e.key === "VERSION");
    const pvp = root?.entries.find((e) => e.key === "PVP");
    const msg = root?.entries.find((e) => e.key === "ServerWelcomeMessage");
    expect(ver?.kind).toBe("number");
    expect(pvp?.kind).toBe("boolean");
    expect(msg?.kind).toBe("string");
  });

  it("populates a flat map", () => {
    const r = parseSandboxLua(SAMPLE);
    expect(r.flat["VERSION"]).toBe(5);
    expect(r.flat["Population.RespawnMultiplier"]).toBe(0.5);
    expect(r.flat["Weather.StartMonth"]).toBe(7);
  });

  it("returns empty for missing SandboxVars block", () => {
    expect(parseSandboxLua("foo")).toEqual({ sections: [], flat: {} });
  });

  it("handles trailing commas and odd whitespace", () => {
    const src = `SandboxVars = {
      A = 1,
      B = {
        C = 2,
      },
    }`;
    const r = parseSandboxLua(src);
    expect(r.flat.A).toBe(1);
    expect(r.flat["B.C"]).toBe(2);
  });

  it("strips line comments before parsing", () => {
    const src = `SandboxVars = {
      -- comment
      A = 1, -- inline comment
      B = 2,
    }`;
    const r = parseSandboxLua(src);
    expect(r.flat.A).toBe(1);
    expect(r.flat.B).toBe(2);
  });

  it("source offsets resolve to the exact raw value literal", () => {
    const src = `SandboxVars = {\n  Zombies = {\n    Speed = 4,\n    Strength = 2,\n  },\n}\n`;
    const p = parseSandboxLua(src);
    for (const section of p.sections) {
      for (const entry of section.entries) {
        const slice = src.slice(entry.valueStart, entry.valueEnd);
        expect(slice.trim()).toBe(String(entry.value));
      }
    }
  });

  it("offsets are correct for quoted strings (includes the quotes)", () => {
    const src = `SandboxVars = {\n  Msg = "hello",\n}\n`;
    const p = parseSandboxLua(src);
    const msg = p.sections.find((s) => s.name === "_root")?.entries.find((e) => e.key === "Msg");
    expect(msg).toBeDefined();
    expect(src.slice(msg!.valueStart, msg!.valueEnd)).toBe('"hello"');
    expect(msg!.value).toBe("hello");
  });

  it("offsets survive surrounding comments (mask preserves positions)", () => {
    const src = `SandboxVars = {\n  -- leading comment\n  A = 42, -- trailing\n  B = 7,\n}\n`;
    const p = parseSandboxLua(src);
    const root = p.sections.find((s) => s.name === "_root");
    const a = root?.entries.find((e) => e.key === "A");
    const b = root?.entries.find((e) => e.key === "B");
    expect(src.slice(a!.valueStart, a!.valueEnd)).toBe("42");
    expect(src.slice(b!.valueStart, b!.valueEnd)).toBe("7");
  });
});
