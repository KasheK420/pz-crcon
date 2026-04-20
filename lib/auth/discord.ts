import { loadEnv } from "@/lib/env";
import { getLogger } from "@/lib/logger";

const log = () => getLogger().child({ mod: "discord" });

interface GuildMember {
  user: { id: string };
  roles: string[];
}

/**
 * Check if a Discord user is a member of the configured guild AND
 * has the configured admin role. Uses the bot token; the bot must be
 * a member of the guild.
 */
export async function checkGuildMembership(discordId: string): Promise<{
  inGuild: boolean;
  hasAdminRole: boolean;
}> {
  const env = loadEnv();
  const url = `https://discord.com/api/v10/guilds/${env.DISCORD_GUILD_ID}/members/${discordId}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
    cache: "no-store",
  });
  if (res.status === 404) {
    log().info({ discordId }, "user not in guild");
    return { inGuild: false, hasAdminRole: false };
  }
  if (!res.ok) {
    log().error({ status: res.status }, "discord guild lookup failed");
    throw new Error(`Discord API ${res.status}`);
  }
  const member = (await res.json()) as GuildMember;
  return {
    inGuild: true,
    hasAdminRole: member.roles.includes(env.DISCORD_ADMIN_ROLE_ID),
  };
}
