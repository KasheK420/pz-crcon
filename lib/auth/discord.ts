import { loadEnv } from "@/lib/env";
import type { Role } from "@/lib/auth/role";

function parseAdminIds(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Resolve what role a Discord user should have based on the `DISCORD_ADMIN_IDS`
 * allowlist. First ID in the list is the OWNER; the rest are ADMINs. Anyone
 * not in the list is rejected (null).
 *
 * No Discord bot / guild required. OAuth proves identity; this list is the
 * entire authorization policy. Suitable for small private servers.
 */
export function resolveRoleForDiscordId(discordId: string): Role | null {
  const env = loadEnv();
  const ids = parseAdminIds(env.DISCORD_ADMIN_IDS);
  if (ids.length === 0) return null;
  if (ids[0] === discordId) return "OWNER";
  if (ids.includes(discordId)) return "ADMIN";
  return null;
}

export function isAllowedDiscordId(discordId: string): boolean {
  return resolveRoleForDiscordId(discordId) !== null;
}
