import type { NextAuthConfig } from "next-auth";
import Discord from "next-auth/providers/discord";
import { prisma } from "@/lib/db/client";
import { loadEnv } from "@/lib/env";
import { checkGuildMembership } from "@/lib/auth/discord";
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
        const { inGuild, hasAdminRole } = await checkGuildMembership(discordId);
        if (!inGuild) {
          log().info({ discordId }, "rejected: not in guild");
          return false;
        }

        // Bootstrap: first OWNER per env var; everyone else VIEWER
        // unless promoted later (or has admin role at creation time).
        const existing = await prisma.user.findUnique({
          where: { discordId },
        });
        if (!existing) {
          const isBootstrap = discordId === env.BOOTSTRAP_OWNER_DISCORD_ID;
          await prisma.user.create({
            data: {
              discordId,
              username: user.name ?? `discord:${discordId}`,
              avatar: user.image,
              role: isBootstrap ? "OWNER" : hasAdminRole ? "ADMIN" : "VIEWER",
            },
          });
          log().info({ discordId, bootstrap: isBootstrap }, "user created");
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
    // No `pages.signIn` override - use Auth.js's built-in /api/auth/signin.
    // Adding a custom /login page is a Phase 2 polish item.
  };
}
