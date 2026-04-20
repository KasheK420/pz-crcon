"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Panel } from "@/components/pz/panel";
import { LiveDot } from "@/components/pz/live-dot";
import { Button } from "@/components/ui/button";
import { AddSteamIdForm } from "./add-steamid-form";

interface WhitelistRow {
  id: string;
  steamId: string;
  name: string;
  isOnline: boolean;
  isBanned: boolean;
  lastSeen: string;
  whitelistedAt: string | null;
  whitelistedById: string | null;
  notes: string | null;
  isPending: boolean;
  hasRealName: boolean;
}

interface ApiResponse {
  players: WhitelistRow[];
}

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

export function WhitelistTable() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/whitelist", { cache: "no-store" });
      if (res.ok) {
        const j: ApiResponse = await res.json();
        setData(j);
      } else {
        toast.error(`Whitelist fetch failed: ${res.status}`);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function remove(p: WhitelistRow) {
    if (
      !confirm(
        `Remove ${p.name} (${p.steamId}) from the whitelist?${
          p.hasRealName
            ? "\n\nThis will also send `removeuserfromwhitelist` to the server."
            : "\n\nThis is a pending entry — only the DB row will be cleared."
        }`,
      )
    ) {
      return;
    }
    setRemoving(p.id);
    try {
      const res = await fetch("/api/whitelist", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ playerId: p.id }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(`Remove failed: ${j.error ?? res.status}`);
        return;
      }
      if (j.rconError) {
        toast.warning(`Removed from DB but RCON failed: ${String(j.rconError).slice(0, 100)}`);
      } else if (j.rconInvoked) {
        toast.success(`Removed ${p.name} (server confirmed).`);
      } else {
        toast.success(`Removed ${p.name} (DB only — pending entry).`);
      }
      refresh();
    } catch (e) {
      toast.error(`Remove failed: ${String(e)}`);
    } finally {
      setRemoving(null);
    }
  }

  const rows = (data?.players ?? []).filter((p) => {
    if (!filter.trim()) return true;
    const q = filter.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      p.steamId.toLowerCase().includes(q) ||
      (p.notes ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <Panel
      title="Whitelist"
      sub={data ? `${data.players.length} ENTRIES` : undefined}
      right={
        <div className="flex items-center gap-2">
          <LiveDot variant={loading ? "warn" : "live"} label={loading ? "LOADING" : "READY"} />
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
      bodyClassName="p-0"
    >
      <div className="p-3 border-b border-pz-border-lo flex flex-col gap-3">
        <div className="bg-pz-bg-1 border border-pz-border-lo px-3 py-2 text-[12px] text-pz-text-dim">
          <strong className="text-pz-text">Note:</strong> Steam ID-based whitelist enforcement
          requires the Phase 4 Lua mod. Until then, pre-listed Steam IDs are stored here as a source
          of truth — username-based whitelist (<code className="pz-mono">addusertowhitelist</code>)
          works today for users who have joined at least once.
        </div>
        <AddSteamIdForm onAdded={refresh} />
        <div className="flex items-center gap-2">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="flex-1 max-w-[400px] bg-pz-bg-0 border border-pz-border-lo px-2 py-1 pz-mono text-xs text-pz-text placeholder:text-pz-muted focus:outline-none focus:border-pz-border-hi"
            placeholder="search name / steam id / notes..."
          />
        </div>
      </div>

      {!data && <div className="p-6 text-center text-pz-muted text-xs">Loading…</div>}
      {data && rows.length === 0 && (
        <div className="p-6 text-center text-pz-muted text-xs">
          {data.players.length === 0
            ? "No players whitelisted yet. Add a Steam ID above."
            : "No entries match the filter."}
        </div>
      )}
      {data && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="pz-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Steam ID</th>
                <th>Status</th>
                <th>Whitelisted</th>
                <th>Last seen</th>
                <th>Notes</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td>
                    <div className="font-medium text-pz-text">{p.name}</div>
                    {p.isPending && (
                      <span className="pz-mono text-[10px] text-pz-amber">
                        pending Steam ID lookup
                      </span>
                    )}
                  </td>
                  <td className="pz-mono text-[11px] text-pz-text-dim">
                    {p.steamId.startsWith("pending:") ? (
                      <span className="text-pz-accent">{p.steamId}</span>
                    ) : (
                      p.steamId
                    )}
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
                    {relativeTime(p.whitelistedAt)}
                  </td>
                  <td className="pz-mono text-[11px] text-pz-muted">{relativeTime(p.lastSeen)}</td>
                  <td className="text-[11px] text-pz-text-dim max-w-[260px]">
                    {p.notes ? (
                      <span title={p.notes}>{p.notes}</span>
                    ) : (
                      <span className="text-pz-muted">—</span>
                    )}
                  </td>
                  <td className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => remove(p)}
                      disabled={removing === p.id}
                    >
                      {removing === p.id ? "..." : "Remove"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
