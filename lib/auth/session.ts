import { auth } from "@/auth";
import { atLeast, type Role } from "@/lib/auth/role";

export interface SessionInfo {
  userId: string;
  discordId: string;
  role: Role;
}

export async function getSession(): Promise<SessionInfo | null> {
  const s = await auth();
  if (!s || !s.userId || !s.discordId || !s.role) return null;
  return { userId: s.userId, discordId: s.discordId, role: s.role };
}

export async function requireRole(min: Role): Promise<SessionInfo> {
  const s = await getSession();
  if (!s) throw new Error("UNAUTHENTICATED");
  if (!atLeast(s.role, min)) throw new Error("FORBIDDEN");
  return s;
}
