import { prisma } from "@/lib/db/client";
import { rconExecute } from "@/lib/rcon/client";
import { parsePlayersOutput } from "@/lib/rcon/parsers";
import { ServerStatusCard } from "@/components/public/server-status-card";
import { TacticalMap } from "@/components/map/tactical-map";
import { ModGrid } from "@/components/public/mod-grid";
import { JoinInfo } from "@/components/public/join-info";
import { Panel } from "@/components/pz/panel";
import { LiveDot } from "@/components/pz/live-dot";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Approximate uptime: the Node process started at import time.
// Matches the /api/status calc so we stay consistent.
const PROCESS_STARTED_AT = Date.now();

async function loadStatus() {
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
  return {
    online,
    serverName: process.env.PUBLIC_SERVER_NAME ?? "MajorlukPZ",
    serverAddress:
      process.env.PUBLIC_SERVER_ADDRESS ?? "pz.majorluk.pl:16261",
    discordUrl: process.env.PUBLIC_DISCORD_URL ?? undefined,
    maxPlayers: Number(process.env.PUBLIC_MAX_PLAYERS ?? 8),
    players,
    mods,
    uptimeSec: Math.floor((Date.now() - PROCESS_STARTED_AT) / 1000),
  };
}

export default async function PublicMapPage() {
  const status = await loadStatus();

  return (
    <main className="mx-auto max-w-[1600px] px-6 py-8 flex flex-col gap-5">
      <ServerStatusCard
        online={status.online}
        serverName={status.serverName}
        playerCount={status.players.count}
        maxPlayers={status.maxPlayers}
        uptimeSec={status.uptimeSec}
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        <Panel
          title="Live Tactical Map"
          sub="STATIC · LIVE POSITIONS IN PHASE 4"
          right={<LiveDot variant={status.online ? "live" : "down"} label={status.online ? "LIVE" : "OFFLINE"} />}
          dense
          bodyClassName="p-0"
        >
          <div className="p-3" style={{ height: 540 }}>
            <TacticalMap />
          </div>
        </Panel>

        <div className="flex flex-col gap-3">
          <JoinInfo
            address={status.serverAddress}
            discordUrl={status.discordUrl}
          />

          <Panel title="Server Rules" sub="V1">
            <ul className="flex flex-col gap-1.5 pl-4 text-xs text-pz-text-dim list-disc">
              <li>PvE only — no player harm.</li>
              <li>Safehouse claims respected.</li>
              <li>No base griefing or fuel theft.</li>
              <li>Discord voice for raids only.</li>
              <li>Admins may rewind your death on request.</li>
            </ul>
          </Panel>

          <Panel title="Ka$heK Survivors" sub="DISCORD">
            {status.discordUrl ? (
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-[#5865f2] grid place-items-center text-white font-bold">
                  D
                </div>
                <div className="flex flex-col flex-1 min-w-0">
                  <div className="font-semibold text-pz-text">Join the Discord</div>
                  <div className="pz-mono text-[10.5px] text-pz-muted">
                    Whitelist · bug reports · clips
                  </div>
                </div>
                <a
                  href={status.discordUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="pz-pill live"
                >
                  JOIN
                </a>
              </div>
            ) : (
              <p className="text-xs text-pz-muted">
                Discord invite not configured.
              </p>
            )}
          </Panel>
        </div>
      </div>

      <ModGrid mods={status.mods} />
    </main>
  );
}
