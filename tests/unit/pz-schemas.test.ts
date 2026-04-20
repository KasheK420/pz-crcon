import { describe, expect, it } from "vitest";
import { PlayerPerksSchema, ThemePrefsSchema } from "@/lib/pz/schemas";

describe("PlayerPerksSchema", () => {
  it("accepts a list of {name, level}", () => {
    const ok = [
      { name: "Aiming", level: 6 },
      { name: "Carpentry", level: 4 },
    ];
    expect(PlayerPerksSchema.parse(ok)).toEqual(ok);
  });
  it("rejects negative levels", () => {
    expect(() => PlayerPerksSchema.parse([{ name: "x", level: -1 }])).toThrow();
  });
  it("rejects empty names", () => {
    expect(() => PlayerPerksSchema.parse([{ name: "", level: 1 }])).toThrow();
  });
});

describe("ThemePrefsSchema", () => {
  it("applies defaults", () => {
    const result = ThemePrefsSchema.parse({});
    expect(result.accent).toBe("green");
    expect(result.intensity).toBe("balanced");
  });
  it("rejects unknown accent", () => {
    expect(() => ThemePrefsSchema.parse({ accent: "purple" })).toThrow();
  });
  it("clamps grain to [0, 0.15]", () => {
    expect(() => ThemePrefsSchema.parse({ grain: 0.5 })).toThrow();
  });
});
