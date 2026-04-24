/**
 * `GET /api/players/[playerId]`  — rich player profile (VIEWER+).
 *
 * Response shape:
 *   player        — every Player column (minus IP unless ADMIN+)
 *   recentActions — AdminActions targeting this player (newest first)
 *   recentEvents  — WorldEvents mentioning this player (Phase 4)
 *   notesRaw      — whatever lives in `Player.notes` (admin-added text)
 */

import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { atLeast } from "@/lib/auth/role";
import { prisma } from "@/lib/db/client";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ playerId: string }> },
) {
  const session = await getSession();
  if (!session || !atLeast(session.role, "VIEWER")) {
    return NextResponse.json({ ok: false, code: "forbidden" }, { status: 403 });
  }
  const { playerId } = await params;
  const player = await prisma.player.findUnique({ where: { id: playerId } });
  if (!player) {
    return NextResponse.json(
      { ok: false, code: "not-found", detail: `no player ${playerId}` },
      { status: 404 },
    );
  }

  const canSeeIp = atLeast(session.role, "ADMIN");
  const recentActions = await prisma.adminAction.findMany({
    where: {
      OR: [
        { target: player.name },
        { details: { path: ["playerId"], equals: player.id } as never },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { user: { select: { username: true, discordId: true } } },
  });

  const recentEvents = await prisma.worldEvent.findMany({
    where: { player: player.name },
    orderBy: { ts: "desc" },
    take: 30,
  });

  return NextResponse.json({
    ok: true,
    player: {
      id: player.id,
      steamId: player.steamId,
      name: player.name,
      firstSeen: player.firstSeen.toISOString(),
      lastSeen: player.lastSeen.toISOString(),
      totalPlaytime: player.totalPlaytime,
      deaths: player.deaths,
      isWhitelisted: player.isWhitelisted,
      whitelistedAt: player.whitelistedAt?.toISOString() ?? null,
      isBanned: player.isBanned,
      banReason: player.banReason,
      banExpiresAt: player.banExpiresAt?.toISOString() ?? null,
      banByUserId: player.banByUserId,
      ipLastSeen: canSeeIp ? player.ipLastSeen : null,
      countryLast: player.countryLast,
      notes: player.notes,
      lastX: player.lastX,
      lastY: player.lastY,
      lastZ: player.lastZ,
      lastRegion: player.lastRegion,
      lastHealth: player.lastHealth,
      lastHunger: player.lastHunger,
      lastFatigue: player.lastFatigue,
      isOnline: player.isOnline,
      inGameDay: player.inGameDay,
      perks: player.perks,
    },
    recentActions: recentActions.map((a) => ({
      id: a.id,
      kind: a.kind,
      target: a.target,
      details: a.details,
      createdAt: a.createdAt.toISOString(),
      user: a.user ? { username: a.user.username, discordId: a.user.discordId } : null,
    })),
    recentEvents: recentEvents.map((e) => ({
      id: e.id,
      kind: e.kind,
      region: e.region,
      x: e.x,
      y: e.y,
      ts: e.ts.toISOString(),
      meta: e.metaJson,
    })),
  });
}
