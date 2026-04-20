export const ROLE_RANK = {
  VIEWER: 1,
  MODERATOR: 2,
  ADMIN: 3,
  OWNER: 4,
} as const;

export type Role = keyof typeof ROLE_RANK;

export function atLeast(have: Role, need: Role): boolean {
  return ROLE_RANK[have] >= ROLE_RANK[need];
}

export function isAdminOrAbove(role: Role): boolean {
  return atLeast(role, "ADMIN");
}

export function isModeratorOrAbove(role: Role): boolean {
  return atLeast(role, "MODERATOR");
}
