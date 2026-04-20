import { decode } from "next-auth/jwt";
import { loadEnv } from "@/lib/env";
import { getSessionCookieName } from "@/lib/auth/cookie-name";
import type { Role } from "@/lib/auth/role";

export interface WsIdentity {
  userId: string;
  discordId: string;
  role: Role;
}

export async function identifyFromCookie(
  cookieHeader: string | undefined
): Promise<WsIdentity | null> {
  if (!cookieHeader) return null;
  const env = loadEnv();
  const cookieName = getSessionCookieName();
  if (!cookieHeader.includes(cookieName)) return null;
  const re = new RegExp(`${cookieName.replace(/[.$]/g, "\\$&")}=([^;]+)`);
  const m = re.exec(cookieHeader);
  if (!m) return null;
  try {
    const decoded = await decode({
      token: m[1],
      secret: env.NEXTAUTH_SECRET,
      salt: cookieName,
    });
    if (!decoded) return null;
    const { userId, discordId, role } = decoded as Record<string, unknown>;
    if (!userId || !discordId || !role) return null;
    return {
      userId: String(userId),
      discordId: String(discordId),
      role: role as Role,
    };
  } catch {
    return null;
  }
}
