import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { atLeast } from "@/lib/auth/role";
import { rconExecute } from "@/lib/rcon/client";
import { parsePlayersOutput } from "@/lib/rcon/parsers";
import * as positions from "@/lib/ingest/positions-store";
import { getLogger } from "@/lib/logger";

const log = () => getLogger().child({ mod: "api/players/positions" });

export const dynamic = "force-dynamic";

interface PositionPoint {
  name: string;
  x: number;
  y: number;
  region: string | null;
  day: number | null;
  /** True when the Lua mod hasn't reported yet; the point is a placeholder. */
  approximate: boolean;
}

// Knox County center-ish (in PZ world coordinates). Picked roughly between
// Muldraugh and West Point so the placeholder cluster sits visibly on the
// tile-rendered Knox map. Used when RCON says a player is online but the
// Lua mod hasn't sent their coordinates yet.
const PLACEHOLDER_X = 11000;
const PLACEHOLDER_Y = 9000;

const FRESH_MS = 30_000;

/**
 * Public endpoint — anyone can see who's connected and where they're
 * roughly placed. Once the Phase 4 Lua mod is posting to `/api/webhook/mod`,
 * we delegate to the in-memory positions store (anonymised for public,
 * precise for VIEWER+). When the store is cold / stale, fall back to the
 * RCON `players` roll-call with placeholder coordinates so the map stays
 * populated.
 */
export async function GET() {
  const session = await getSession();
  const isAdmin = Boolean(session && atLeast(session.role, "VIEWER"));

  const now = Date.now();
  const storeFresh =
    positions.all().some((p) => now - p.receivedAt < FRESH_MS) ||
    (positions.lastHeartbeatAt() !== null &&
      now - (positions.lastHeartbeatAt() as number) < FRESH_MS);

  if (storeFresh) {
    const points: PositionPoint[] = isAdmin
      ? positions.all().map((p) => ({
          name: p.name,
          x: p.x,
          y: p.y,
          region: p.region,
          day: p.inGameDay,
          approximate: false,
        }))
      : positions.publicView().map((p) => ({
          name: `Survivor-${p.token}`,
          x: p.x,
          y: p.y,
          region: p.region,
          day: null,
          approximate: false,
        }));
    return NextResponse.json({
      online: true,
      count: points.length,
      positions: points,
      source: "lua-mod",
      ts: now,
    });
  }

  try {
    const raw = await rconExecute("players");
    const parsed = parsePlayersOutput(raw);
    const points: PositionPoint[] = parsed.names.map((name) => ({
      name,
      x: PLACEHOLDER_X,
      y: PLACEHOLDER_Y,
      region: null,
      day: null,
      approximate: true,
    }));
    return NextResponse.json({
      online: true,
      count: parsed.count,
      positions: points,
      source: "rcon-fallback",
      ts: now,
    });
  } catch (e) {
    log().warn({ err: e }, "rcon players failed");
    return NextResponse.json(
      {
        online: false,
        count: 0,
        positions: [] as PositionPoint[],
        source: "offline",
        ts: now,
      },
      { status: 200 },
    );
  }
}
