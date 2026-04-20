import { describe, it, expect } from "vitest";
import { validateSandboxPatch, validateIniPatch } from "@/lib/pz/validate";

describe("validateSandboxPatch", () => {
  it("accepts valid float in range (FoodLootNew)", () => {
    // FoodLootNew: type float, min 0, max 4
    const r = validateSandboxPatch({ FoodLootNew: 1.5 });
    expect(r.ok).toBe(true);
  });

  it("rejects out-of-range float (FoodLootNew > max)", () => {
    const r = validateSandboxPatch({ FoodLootNew: 99 });
    expect(r.ok).toBe(false);
    expect(r.errors?.[0].path).toBe("FoodLootNew");
    expect(r.errors?.[0].code).toBe("range");
  });

  it("rejects out-of-range (under min)", () => {
    const r = validateSandboxPatch({ FoodLootNew: -1 });
    expect(r.ok).toBe(false);
    expect(r.errors?.[0].code).toBe("range");
  });

  it("rejects unknown key", () => {
    const r = validateSandboxPatch({ "Nope.X": 1 });
    expect(r.ok).toBe(false);
    expect(r.errors?.[0].code).toBe("unknown-key");
  });

  it("rejects wrong type (bool key given a number)", () => {
    // ZombieVoronoiNoise: bool
    const r = validateSandboxPatch({ ZombieVoronoiNoise: 5 });
    expect(r.ok).toBe(false);
    expect(r.errors?.[0].code).toBe("type");
  });

  it("accepts valid enum value", () => {
    // ZombieLore.Speed: enum, options 1..4
    const r = validateSandboxPatch({ "ZombieLore.Speed": 2 });
    expect(r.ok).toBe(true);
  });

  it("rejects invalid enum value", () => {
    const r = validateSandboxPatch({ "ZombieLore.Speed": 999 });
    expect(r.ok).toBe(false);
    expect(r.errors?.[0].code).toBe("enum");
  });

  it("collects multiple errors across keys", () => {
    const r = validateSandboxPatch({
      FoodLootNew: 99, // range
      "Nope.X": 1, // unknown-key
      ZombieVoronoiNoise: true, // ok
    });
    expect(r.ok).toBe(false);
    expect(r.errors?.length).toBe(2);
  });
});

describe("validateIniPatch", () => {
  it("accepts in-range int (MaxPlayers)", () => {
    const r = validateIniPatch({ MaxPlayers: 16 });
    expect(r.ok).toBe(true);
  });

  it("rejects out-of-range int (MaxPlayers > max)", () => {
    const r = validateIniPatch({ MaxPlayers: 999 });
    expect(r.ok).toBe(false);
    expect(r.errors?.[0].code).toBe("range");
  });

  it("rejects non-integer where int required", () => {
    const r = validateIniPatch({ MaxPlayers: 3.5 });
    expect(r.ok).toBe(false);
    // Zod treats `.int()` failures as invalid_type → our mapper returns "type".
    expect(r.errors?.[0].code).toBe("type");
  });

  it("accepts boolean for bool key (Open)", () => {
    expect(validateIniPatch({ Open: true }).ok).toBe(true);
    expect(validateIniPatch({ Open: false }).ok).toBe(true);
  });

  it("accepts \"true\"/\"false\" string for bool key (Open)", () => {
    expect(validateIniPatch({ Open: "true" }).ok).toBe(true);
    expect(validateIniPatch({ Open: "false" }).ok).toBe(true);
  });

  it("rejects other strings for bool key", () => {
    const r = validateIniPatch({ Open: "yeah" });
    expect(r.ok).toBe(false);
    expect(r.errors?.[0].code).toBe("type");
  });

  it("rejects unknown ini key", () => {
    const r = validateIniPatch({ NoSuchKey: "x" });
    expect(r.ok).toBe(false);
    expect(r.errors?.[0].code).toBe("unknown-key");
  });
});
