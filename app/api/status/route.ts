import { NextResponse } from "next/server";
import { rconExecute, getFirstConnectAt } from "@/lib/rcon/client";
import { parsePlayersOutput } from "@/lib/rcon/parsers";
import { prisma } from "@/lib/db/client";
import { getLastTps } from "@/lib/ws/log-streamer";
import { historyView, recordSample } from "@/lib/observability/player-history";
import { heartbeat as luaHeartbeat } from "@/lib/ingest/positions-store";

let cache: { at: number; data: unknown } | null = null;
const TTL_MS = 10_000;

// Fallback uptime: seconds since this Node process started.
// Preferred: seconds since first successful RCON connect (set by
// rcon/client.ts), which more closely tracks the PZ server itself.
const PROCESS_STARTED_AT = Date.now();

export async function GET() {
  if (cache && Date.now() - cache.at < TTL_MS) {
    return NextResponse.json(cache.data);
  }
  let players = { count: 0, names: [] as string[] };
  let online = false;
  try {
    const raw = await rconExecute("players");
    players = parsePlayersOutput(raw);
    online = true;
  } catch {
    online = false;
  }
  const mods = await prisma.mod.findMany({
    where: { enabled: true },
    select: { workshopId: true, modId: true, name: true, version: true },
    orderBy: { loadOrder: "asc" },
  });
  const firstConnectAt = getFirstConnectAt();
  const uptimeSec = Math.floor(
    (Date.now() - (firstConnectAt ?? PROCESS_STARTED_AT)) / 1000
  );

  // Feed the 24 h sparkline ring buffer. Only sample when we actually
  // got a fresh RCON read — otherwise the buffer would get confused by
  // "RCON offline ⇒ zero players" during a brief PZ restart.
  if (online) {
    recordSample(players.count);
  }
  const history = historyView();

  // Lua-mod heartbeat: preferred source of truth for TPS / in-game day /
  // hour. Falls back to the log-scraper TPS when the mod hasn't posted
  // recently (or isn't installed at all).
  const hb = luaHeartbeat();
  const tps = hb.fresh && hb.tps !== null ? hb.tps : getLastTps();

  const data = {
    online,
    serverName: process.env.PUBLIC_SERVER_NAME ?? "MajorlukPZ",
    players: { count: players.count, names: players.names },
    mods,
    uptimeSec,
    uptimeSource: firstConnectAt ? "rcon-connect" : "process-start",
    tps,
    inGameDay: hb.fresh ? hb.day : null,
    inGameHourMin: hb.fresh ? hb.hourMin : null,
    luaModFresh: hb.fresh,
    luaModHeartbeatAt: hb.at,
    history,
    ts: Date.now(),
  };
  cache = { at: Date.now(), data };
  return NextResponse.json(data);
}
