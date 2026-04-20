import { describe, expect, it } from "vitest";
import { atLeast, ROLE_RANK, type Role } from "@/lib/auth/role";

describe("role hierarchy", () => {
  it("orders OWNER > ADMIN > MODERATOR > VIEWER", () => {
    expect(ROLE_RANK.OWNER).toBeGreaterThan(ROLE_RANK.ADMIN);
    expect(ROLE_RANK.ADMIN).toBeGreaterThan(ROLE_RANK.MODERATOR);
    expect(ROLE_RANK.MODERATOR).toBeGreaterThan(ROLE_RANK.VIEWER);
  });

  it.each<[Role, Role, boolean]>([
    ["OWNER", "OWNER", true],
    ["OWNER", "ADMIN", true],
    ["ADMIN", "OWNER", false],
    ["ADMIN", "MODERATOR", true],
    ["MODERATOR", "ADMIN", false],
    ["VIEWER", "VIEWER", true],
    ["VIEWER", "MODERATOR", false],
  ])("atLeast(%s, %s) === %s", (have, need, expected) => {
    expect(atLeast(have, need)).toBe(expected);
  });
});
