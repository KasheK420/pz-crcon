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
});
