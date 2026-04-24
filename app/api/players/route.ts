import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { rconExecute } from "@/lib/rcon/client";
import { parsePlayersOutput } from "@/lib/rcon/parsers";
import { prisma } from "@/lib/db/client";
import { getLogger } from "@/lib/logger";

const log = () => getLogger().child({ mod: "api/players" });

/**
 * Merge the DB player roster with the RCON live player list.
 *
 * PZ RCON `players` only returns names (no Steam IDs). For Phase 1 we
 * match on name and auto-seed a Player row for online names not yet
 * in the DB. This bootstrap will be replaced by the Lua mod in Phase 4
 * which ships real Steam IDs.
 */
export async function GET(req: Request) {
  try {
    await requireRole("VIEWER");
  } catch (e) {
    const status = (e as Error).message === "FORBIDDEN" ? 403 : 401;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }

  const url = new URL(req.url);
  const onlineOnly = url.searchParams.get("online") === "true";

  // Try RCON — absence of live data is non-fatal (server might be down).
  let onlineNames: string[] = [];
  let serverOnline = false;
  try {
    const raw = await rconExecute("players");
    const parsed = parsePlayersOutput(raw);
    onlineNames = parsed.names;
    serverOnline = true;
  } catch (e) {
    log().warn({ err: e }, "rcon players failed, falling back to DB-only");
  }

  // Sync DB isOnline state against the live RCON roster. CRITICAL: run
  // this even when `onlineNames` is empty, otherwise a completely empty
  // server leaves every previous "online" row stuck at isOnline=true
  // forever (reproduced as "2d ago ● ONLINE" in the UI after PZ had no
  // connections for a while).
  if (serverOnline) {
    if (onlineNames.length > 0) {
      const existing = await prisma.player.findMany({
        where: { name: { in: onlineNames } },
        select: { name: true },
      });
      const existingNames = new Set(existing.map((p) => p.name));
      const unseen = onlineNames.filter((n) => !existingNames.has(n));
      if (unseen.length > 0) {
        // steamId is required + unique. Without the Lua mod we don't
        // know it yet, so we synthesize a stable placeholder per name.
        // The Lua mod will overwrite these when it lands in Phase 4.
        await prisma.$transaction(
          unseen.map((name) =>
            prisma.player.upsert({
              where: { steamId: `pending:${name}` },
              update: { lastSeen: new Date(), isOnline: true },
              create: {
                steamId: `pending:${name}`,
                name,
                isOnline: true,
                lastSeen: new Date(),
              },
            }),
          ),
        );
      }
      await prisma.player.updateMany({
        where: { name: { in: onlineNames } },
        data: { isOnline: true, lastSeen: new Date() },
      });
      await prisma.player.updateMany({
        where: { name: { notIn: onlineNames }, isOnline: true },
        data: { isOnline: false },
      });
    } else {
      // Empty roster — nobody is online right now. Clear every stale
      // `isOnline=true` flag.
      await prisma.player.updateMany({
        where: { isOnline: true },
        data: { isOnline: false },
      });
    }
  }

  const where = onlineOnly ? { isOnline: true } : {};
  const players = await prisma.player.findMany({
    where,
    orderBy: [{ isOnline: "desc" }, { lastSeen: "desc" }],
  });

  return NextResponse.json({
    serverOnline,
    onlineCount: onlineNames.length,
    players: players.map((p) => ({
      id: p.id,
      steamId: p.steamId,
      name: p.name,
      isOnline: p.isOnline,
      isBanned: p.isBanned,
      banReason: p.banReason,
      lastSeen: p.lastSeen,
      firstSeen: p.firstSeen,
      deaths: p.deaths,
      totalPlaytime: p.totalPlaytime,
      isWhitelisted: p.isWhitelisted,
      countryLast: p.countryLast,
      lastRegion: p.lastRegion,
      notes: p.notes,
    })),
  });
}
