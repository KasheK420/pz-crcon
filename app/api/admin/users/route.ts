/**
 * `GET /api/admin/users` — list all `User` rows (OWNER only).
 *
 * Lists every user the panel has ever seen via Discord OAuth. Use the
 * Settings UI to promote/demote roles or revoke access. Removing a user
 * row from the DB doesn't un-allowlist them — that lives in
 * `DISCORD_ADMIN_IDS`. If their Discord ID is still in the env var,
 * signing in again re-creates the row with the default role logic.
 */

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { atLeast } from "@/lib/auth/role";
import { prisma } from "@/lib/db/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session || !atLeast(session.role, "OWNER")) {
    return NextResponse.json({ ok: false, code: "forbidden" }, { status: 403 });
  }
  const rows = await prisma.user.findMany({
    orderBy: [{ role: "asc" }, { username: "asc" }],
    select: {
      id: true,
      discordId: true,
      username: true,
      avatar: true,
      role: true,
      createdAt: true,
      lastLogin: true,
    },
  });
  // Flag which rows correspond to `DISCORD_ADMIN_IDS` entries so the UI
  // can explain why some roles "come back" after demote-and-redeploy.
  const allow = (process.env.DISCORD_ADMIN_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const allowSet = new Set(allow);
  const firstAllow = allow[0] ?? null;
  const users = rows.map((u) => ({
    ...u,
    createdAt: u.createdAt.toISOString(),
    lastLogin: u.lastLogin?.toISOString() ?? null,
    inAllowlist: allowSet.has(u.discordId),
    allowlistRank:
      u.discordId === firstAllow
        ? "OWNER"
        : allowSet.has(u.discordId)
          ? "ADMIN"
          : null,
  }));
  return NextResponse.json({ ok: true, users });
}
