import type { NextAuthConfig } from "next-auth";
import Discord from "next-auth/providers/discord";
import { prisma } from "@/lib/db/client";
import { loadEnv } from "@/lib/env";
import { resolveRoleForDiscordId } from "@/lib/auth/discord";
import { getSessionCookieName } from "@/lib/auth/cookie-name";
import type { Role } from "@/lib/auth/role";
import { getLogger } from "@/lib/logger";

const log = () => getLogger().child({ mod: "auth" });

export function buildAuthConfig(): NextAuthConfig {
  const env = loadEnv();
  const cookieName = getSessionCookieName();
  const useSecure = env.APP_URL.startsWith("https://");
  return {
    secret: env.NEXTAUTH_SECRET,
    trustHost: true,
    session: { strategy: "jwt", maxAge: 24 * 60 * 60 },
    cookies: {
      sessionToken: {
        name: cookieName,
        options: {
          httpOnly: true,
          sameSite: "lax",
          path: "/",
          secure: useSecure,
        },
      },
    },
    providers: [
      Discord({
        clientId: env.DISCORD_CLIENT_ID,
        clientSecret: env.DISCORD_CLIENT_SECRET,
        authorization: { params: { scope: "identify" } },
      }),
    ],
    callbacks: {
      async signIn({ user, account }) {
        if (!account || !account.providerAccountId) return false;
        const discordId = account.providerAccountId;
        const role = resolveRoleForDiscordId(discordId);
        if (!role) {
          log().info({ discordId }, "rejected: not in DISCORD_ADMIN_IDS");
          return false;
        }

        const existing = await prisma.user.findUnique({
          where: { discordId },
        });
        if (!existing) {
          await prisma.user.create({
            data: {
              discordId,
              username: user.name ?? `discord:${discordId}`,
              avatar: user.image,
              role,
            },
          });
          log().info({ discordId, role }, "user created");
        } else {
          await prisma.user.update({
            where: { discordId },
            data: { lastLogin: new Date() },
          });
        }
        return true;
      },
      async jwt({ token, account }) {
        if (account?.providerAccountId) {
          token.discordId = account.providerAccountId;
        }
        if (token.discordId) {
          const u = await prisma.user.findUnique({
            where: { discordId: token.discordId as string },
          });
          if (u) {
            token.role = u.role;
            token.userId = u.id;
          }
        }
        return token;
      },
      async session({ session, token }) {
        if (token.userId) session.userId = token.userId as string;
        if (token.role) session.role = token.role as Role;
        if (token.discordId) session.discordId = token.discordId as string;
        return session;
      },
    },
  };
}
