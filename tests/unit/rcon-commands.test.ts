import { describe, expect, it } from "vitest";
import {
  findCommand,
  RCON_COMMANDS,
  RCON_CATEGORIES,
  type RconCommandSpec,
} from "@/lib/rcon/commands";
import { atLeast, type Role } from "@/lib/auth/role";

describe("RCON_COMMANDS catalog", () => {
  it("has the full Phase 1.6 set (45 commands)", () => {
    expect(RCON_COMMANDS).toHaveLength(45);
  });

  it("every entry has the required fields", () => {
    for (const c of RCON_COMMANDS) {
      expect(c.name, `name on ${JSON.stringify(c)}`).toMatch(/^\w+$/);
      expect(c.signature.length).toBeGreaterThan(0);
      expect(c.description.length).toBeGreaterThan(0);
      expect(c.category).toBeDefined();
      expect(["MODERATOR", "ADMIN", "OWNER"]).toContain(c.requires);
      expect(c.examples).toBeDefined();
      expect((c.examples ?? []).length).toBeGreaterThan(0);
    }
  });

  it("command names are unique", () => {
    const names = RCON_COMMANDS.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("every category in catalog is present in RCON_CATEGORIES", () => {
    const known = new Set(RCON_CATEGORIES.map((c) => c.key));
    for (const c of RCON_COMMANDS) {
      expect(known.has(c.category), `unknown category ${c.category}`).toBe(true);
    }
  });

  it("includes core commands from Phase 1", () => {
    const core = ["players", "save", "quit", "chopper", "servermsg"];
    for (const name of core) {
      expect(findCommand(name)).toBeDefined();
    }
  });

  it("includes new whitelist commands", () => {
    expect(findCommand("addusertowhitelist")).toBeDefined();
    expect(findCommand("removeuserfromwhitelist")).toBeDefined();
    expect(findCommand("addalltowhitelist")).toBeDefined();
  });
});

describe("findCommand", () => {
  it("returns the spec by exact name", () => {
    const spec = findCommand("save");
    expect(spec?.requires).toBe("ADMIN");
    expect(spec?.category).toBe("server");
  });

  it("returns undefined for unknown command", () => {
    expect(findCommand("doesnotexist")).toBeUndefined();
  });
});

describe("role gating via catalog", () => {
  function visibleFor(role: Role): RconCommandSpec[] {
    return RCON_COMMANDS.filter((c) => atLeast(role, c.requires));
  }

  it("VIEWER can invoke nothing", () => {
    expect(visibleFor("VIEWER")).toHaveLength(0);
  });

  it("MODERATOR can invoke moderator-tier commands but not ADMIN/OWNER", () => {
    const v = visibleFor("MODERATOR");
    expect(v.some((c) => c.name === "players")).toBe(true);
    expect(v.some((c) => c.name === "save")).toBe(false);
    expect(v.some((c) => c.name === "quit")).toBe(false);
  });

  it("ADMIN can invoke moderator + admin tiers but not OWNER-only", () => {
    const v = visibleFor("ADMIN");
    expect(v.some((c) => c.name === "save")).toBe(true);
    expect(v.some((c) => c.name === "players")).toBe(true);
    expect(v.some((c) => c.name === "quit")).toBe(false);
    expect(v.some((c) => c.name === "removezombies")).toBe(false);
  });

  it("OWNER can invoke everything", () => {
    expect(visibleFor("OWNER")).toHaveLength(RCON_COMMANDS.length);
  });
});
