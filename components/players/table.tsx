"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LiveDot } from "@/components/pz/live-dot";
import { Panel } from "@/components/pz/panel";
import { PlayerRowActions } from "./player-row-actions";
import type { PlayersResponse } from "./types";
import type { Role } from "@/lib/auth/role";

interface Props {
  role: Role;
  /** When true, only render the online subset and use ?online=true upstream. */
  onlineOnly?: boolean;
  /** Initial roster from the server component. */
  initial?: PlayersResponse;
  /** Render a wrapping Panel + heading. */
  withPanel?: boolean;
  /** Title override for the panel. */
  title?: string;
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

export function PlayersTable({
  role,
  onlineOnly = false,
  initial,
  withPanel = true,
  title = "Players",
}: Props) {
  const [data, setData] = useState<PlayersResponse | null>(initial ?? null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "online" | "banned">(
    onlineOnly ? "online" : "all"
  );
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const url = onlineOnly ? "/api/players?online=true" : "/api/players";
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) {
        const j: PlayersResponse = await res.json();
        setData(j);
      }
    } finally {
      setLoading(false);
    }
  }, [onlineOnly]);

  // Initial fetch if not seeded.
  useEffect(() => {
    if (!data) refresh();
  }, [data, refresh]);

  // Auto-refresh every 15s.
  useEffect(() => {
    const id = setInterval(refresh, 15_000);
    return () => clearInterval(id);
  }, [refresh]);

  const rows = useMemo(() => {
    if (!data) return [];
    return data.players.filter((p) => {
      if (filter === "online" && !p.isOnline) return false;
      if (filter === "banned" && !p.isBanned) return false;
      if (search && !p.name.toLowerCase().includes(search.toLowerCase()))
        return false;
      return true;
    });
  }, [data, filter, search]);

  const onlineCount = data?.players.filter((p) => p.isOnline).length ?? 0;
  const bannedCount = data?.players.filter((p) => p.isBanned).length ?? 0;

  const inner = (
    <>
      {!onlineOnly && (
        <div className="flex items-center gap-2 flex-wrap p-3 border-b border-pz-border-lo">
          <div className="flex gap-1">
            {(["all", "online", "banned"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className={`pz-pill ${filter === k ? "live" : ""} cursor-pointer`}
              >
                {k}
              </button>
            ))}
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name..."
            className="ml-2 flex-1 max-w-[300px] bg-pz-bg-0 border border-pz-border-lo px-2 py-1 pz-mono text-xs text-pz-text placeholder:text-pz-muted focus:outline-none focus:border-pz-border-hi"
          />
          <span className="ml-auto pz-mono text-[10.5px] text-pz-muted uppercase tracking-wider">
            {data ? `${data.players.length} TOTAL · ${onlineCount} ONLINE · ${bannedCount} BANNED` : "—"}
          </span>
        </div>
      )}

      {!data && (
        <div className="p-6 text-center text-pz-muted text-xs">Loading…</div>
      )}
      {data && rows.length === 0 && (
        <div className="p-6 text-center text-pz-muted text-xs">
          {onlineOnly
            ? "No players online right now."
            : "No players match the current filter."}
        </div>
      )}
      {data && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="pz-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Last seen</th>
                <th>Deaths</th>
                <th>Steam ID</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 grid place-items-center bg-pz-bg-3 text-pz-text-dim font-display font-bold text-xs rounded-sm">
                        {p.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <Link
                          href={`/admin/players/${p.id}`}
                          className="font-medium text-pz-text hover:text-pz-primary"
                        >
                          {p.name}
                        </Link>
                        <div className="pz-mono text-[10px] text-pz-muted">#{p.id.slice(0, 8)}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    {p.isBanned ? (
                      <span className="pz-badge red">● BANNED</span>
                    ) : p.isOnline ? (
                      <span className="pz-badge green">● ONLINE</span>
                    ) : (
                      <span className="pz-badge">OFFLINE</span>
                    )}
                  </td>
                  <td className="pz-mono text-[11px] text-pz-muted">
                    {relativeTime(p.lastSeen)}
                  </td>
                  <td className="pz-mono">{p.deaths}</td>
                  <td className="pz-mono text-[11px] text-pz-muted">
                    {p.steamId.startsWith("pending:") ? (
                      <span className="text-pz-accent">pending</span>
                    ) : (
                      p.steamId
                    )}
                  </td>
                  <td className="text-right">
                    <PlayerRowActions
                      player={p}
                      role={role}
                      onRefresh={refresh}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );

  if (!withPanel) return inner;

  return (
    <Panel
      title={title}
      sub={data ? `${data.onlineCount} ONLINE` : undefined}
      right={
        <div className="flex items-center gap-2">
          {data?.serverOnline ? (
            <LiveDot variant="live" label="LIVE" />
          ) : (
            <LiveDot variant="down" label="RCON DOWN" />
          )}
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="pz-pill cursor-pointer"
          >
            {loading ? "..." : "REFRESH"}
          </button>
        </div>
      }
      dense
    >
      {inner}
    </Panel>
  );
}
