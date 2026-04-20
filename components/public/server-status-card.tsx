import { LiveDot } from "@/components/pz/live-dot";

interface Props {
  online: boolean;
  serverName: string;
  playerCount: number;
  maxPlayers: number;
  uptimeSec: number;
}

function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}D ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function ServerStatusCard({
  online,
  serverName,
  playerCount,
  maxPlayers,
  uptimeSec,
}: Props) {
  return (
    <div className="pz-hero">
      <div className="hazard-tape" />
      <div className="pz-hero-body">
        <div>
          <div className="flex items-center gap-3">
            <span className="pz-label">Knox County Quarantine Zone · Private Server</span>
            <LiveDot variant={online ? "live" : "down"} label={online ? "ONLINE" : "OFFLINE"} />
          </div>
          <div className="pz-hero-title">
            {serverName.toUpperCase()} <span className="accent">{"//"}</span> B42 UNSTABLE
          </div>
          <div className="pz-mono text-[11.5px] text-pz-muted mt-2">
            EST. 2024 · CZ/SK SURVIVORS · LONG-WIPE · PVE
          </div>
        </div>
        <div className="pz-hero-stats">
          <div className="pz-hero-stat">
            <div className="pz-label">PLAYERS</div>
            <div className="big">
              {playerCount}
              <span className="dim">/{maxPlayers}</span>
            </div>
          </div>
          <div className="pz-sep-v" />
          <div className="pz-hero-stat">
            <div className="pz-label">UPTIME</div>
            <div className="big">{formatUptime(uptimeSec)}</div>
          </div>
          <div className="pz-sep-v" />
          <div className="pz-hero-stat">
            <div className="pz-label">STATUS</div>
            <div className="small">
              {online ? (
                <span className="text-pz-primary">RCON responding</span>
              ) : (
                <span className="text-pz-danger">RCON unreachable</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
