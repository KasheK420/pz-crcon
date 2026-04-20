import { NextResponse } from "next/server";
import { rconExecute } from "@/lib/rcon/client";
import { parsePlayersOutput } from "@/lib/rcon/parsers";
import { getLogger } from "@/lib/logger";

const log = () => getLogger().child({ mod: "api/players/positions" });

export const dynamic = "force-dynamic";

interface PositionPoint {
  name: string;
  x: number;
  y: number;
  region: string | null;
  day: number | null;
  /** True until the Lua mod ships real coords (Phase 4). */
  approximate: boolean;
}

// Knox County center-ish (in PZ world coordinates). Picked roughly between
// Muldraugh and West Point so the placeholder cluster sits visibly on the
// tile-rendered Knox map. Real coordinates land with the Lua mod.
const PLACEHOLDER_X = 11000;
const PLACEHOLDER_Y = 9000;

/**
 * Public endpoint — anyone can see who's connected and where they're
 * roughly placed. Real per-player coordinates require the Phase 4 Lua
 * mod; until then every online player is rendered at a single placeholder
 * point in the middle of Knox County and flagged `approximate: true`.
 */
export async function GET() {
  try {
    const raw = await rconExecute("players");
    const parsed = parsePlayersOutput(raw);
    const positions: PositionPoint[] = parsed.names.map((name) => ({
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
      positions,
      ts: Date.now(),
    });
  } catch (e) {
    log().warn({ err: e }, "rcon players failed");
    return NextResponse.json(
      {
        online: false,
        count: 0,
        positions: [] as PositionPoint[],
        ts: Date.now(),
      },
      { status: 200 }
    );
  }
}
