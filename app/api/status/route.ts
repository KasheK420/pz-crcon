import { NextResponse } from "next/server";
import { rconExecute } from "@/lib/rcon/client";
import { parsePlayersOutput } from "@/lib/rcon/parsers";
import { prisma } from "@/lib/db/client";

let cache: { at: number; data: unknown } | null = null;
const TTL_MS = 10_000;

// Approximate uptime: seconds since this Node process started.
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
  const data = {
    online,
    serverName: process.env.PUBLIC_SERVER_NAME ?? "MajorlukPZ",
    players: { count: players.count, names: players.names },
    mods,
    uptimeSec: Math.floor((Date.now() - PROCESS_STARTED_AT) / 1000),
    ts: Date.now(),
  };
  cache = { at: Date.now(), data };
  return NextResponse.json(data);
}
