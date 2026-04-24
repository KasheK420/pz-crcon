"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Panel } from "@/components/pz/panel";
import { LiveDot } from "@/components/pz/live-dot";
import { Button } from "@/components/ui/button";
import { csrfFetch } from "@/lib/csrf/fetch";
import type { Role } from "@/lib/auth/role";

interface PlayerData {
  id: string;
  steamId: string;
  name: string;
  firstSeen: string;
  lastSeen: string;
  totalPlaytime: number;
  deaths: number;
  isWhitelisted: boolean;
  whitelistedAt: string | null;
  isBanned: boolean;
  banReason: string | null;
  banExpiresAt: string | null;
  banByUserId: string | null;
  ipLastSeen: string | null;
  countryLast: string | null;
  notes: string | null;
  lastRegion: string | null;
  lastHealth: number | null;
  lastHunger: number | null;
  lastFatigue: number | null;
  isOnline: boolean;
  inGameDay: number | null;
  perks: unknown;
}

interface ActionRow {
  id: string;
  kind: string;
  target: string | null;
  details: Record<string, unknown>;
  createdAt: string;
  user: { username: string; discordId: string } | null;
}

interface EventRow {
  id: string;
  kind: string;
  region: string | null;
  x: number | null;
  y: number | null;
  ts: string;
  meta: Record<string, unknown> | null;
}

interface ApiResponse {
  ok: true;
  player: PlayerData;
  recentActions: ActionRow[];
  recentEvents: EventRow[];
}

const DURATIONS: Array<{ label: string; hours: number }> = [
  { label: "1 hour", hours: 1 },
  { label: "1 day", hours: 24 },
  { label: "7 days", hours: 24 * 7 },
  { label: "30 days", hours: 24 * 30 },
  { label: "Permanent", hours: 0 },
];

function relTime(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const abs = Math.abs(ms);
  const suffix = ms < 0 ? "from now" : "ago";
  if (abs < 60_000) return `${Math.floor(abs / 1000)}s ${suffix}`;
  if (abs < 3_600_000) return `${Math.floor(abs / 60_000)}m ${suffix}`;
  if (abs < 86_400_000) return `${Math.floor(abs / 3_600_000)}h ${suffix}`;
  return `${Math.floor(abs / 86_400_000)}d ${suffix}`;
}

export function PlayerProfile({
  playerId,
  role,
}: {
  playerId: string;
  role: Role;
}) {
  const canBan = role === "ADMIN" || role === "OWNER";
  const canNote = role === "MODERATOR" || role === "ADMIN" || role === "OWNER";
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const [notesDraft, setNotesDraft] = useState("");
  const [banOpen, setBanOpen] = useState(false);
  const [banReason, setBanReason] = useState("");
  const [banHours, setBanHours] = useState(24);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/players/${playerId}`, { cache: "no-store" });
      if (res.ok) {
        const j = (await res.json()) as ApiResponse;
        setData(j);
        setNotesDraft(j.player.notes ?? "");
      } else {
        toast.error(`Profile fetch failed: ${res.status}`);
      }
    } finally {
      setLoading(false);
    }
  }, [playerId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function saveNotes() {
    setBusy("__notes__");
    try {
      const res = await csrfFetch(`/api/players/${playerId}/notes`, {
        method: "PUT",
        body: JSON.stringify({ notes: notesDraft || null }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(`Notes save failed: ${j.detail ?? res.status}`);
        return;
      }
      toast.success("Notes saved");
      refresh();
    } finally {
      setBusy(null);
    }
  }

  async function submitBan() {
    if (!banReason.trim()) {
      toast.error("Ban reason is required");
      return;
    }
    setBusy("__ban__");
    try {
      const res = await csrfFetch(`/api/players/${playerId}/ban`, {
        method: "POST",
        body: JSON.stringify({
          reason: banReason.trim(),
          durationHours: banHours,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(`Ban failed: ${j.error ?? j.detail ?? res.status}`);
        return;
      }
      toast.success(
        `Banned ${data?.player.name}${
          banHours > 0 ? ` for ${banHours}h` : " permanently"
        }`,
      );
      setBanOpen(false);
      setBanReason("");
      refresh();
    } finally {
      setBusy(null);
    }
  }

  async function unban() {
    if (!confirm(`Unban ${data?.player.name}?`)) return;
    setBusy("__unban__");
    try {
      const res = await csrfFetch(`/api/players/${playerId}/unban`, {
        method: "POST",
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(`Unban failed: ${j.error ?? res.status}`);
        return;
      }
      toast.success(`Unbanned ${data?.player.name}`);
      refresh();
    } finally {
      setBusy(null);
    }
  }

  if (!data) {
    return <div className="p-6 text-center text-pz-muted text-xs">Loading…</div>;
  }

  const p = data.player;

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title={p.name}
        sub={`STEAM ${p.steamId}`}
        right={
          <div className="flex items-center gap-2">
            {p.isOnline ? (
              <LiveDot variant="live" label="ONLINE" />
            ) : (
              <LiveDot variant="down" label="OFFLINE" />
            )}
            {p.isBanned && <span className="pz-badge red">● BANNED</span>}
            {p.isWhitelisted && <span className="pz-badge green">● WL</span>}
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 pz-mono text-[11px]">
          <div>
            <div className="text-pz-muted">First seen</div>
            <div className="text-pz-text">{relTime(p.firstSeen)}</div>
          </div>
          <div>
            <div className="text-pz-muted">Last seen</div>
            <div className="text-pz-text">{relTime(p.lastSeen)}</div>
          </div>
          <div>
            <div className="text-pz-muted">Playtime</div>
            <div className="text-pz-text">
              {Math.floor(p.totalPlaytime / 3600)}h {Math.floor((p.totalPlaytime % 3600) / 60)}m
            </div>
          </div>
          <div>
            <div className="text-pz-muted">Deaths</div>
            <div className="text-pz-text">{p.deaths}</div>
          </div>
          <div>
            <div className="text-pz-muted">Last region</div>
            <div className="text-pz-text">{p.lastRegion ?? "—"}</div>
          </div>
          <div>
            <div className="text-pz-muted">In-game day</div>
            <div className="text-pz-text">{p.inGameDay ?? "—"}</div>
          </div>
          <div>
            <div className="text-pz-muted">Country</div>
            <div className="text-pz-text">{p.countryLast ?? "—"}</div>
          </div>
          <div>
            <div className="text-pz-muted">Last IP</div>
            <div className="text-pz-text">
              {p.ipLastSeen ? p.ipLastSeen : <span className="text-pz-muted">—</span>}
            </div>
          </div>
        </div>

        {p.isBanned && (
          <div className="bg-pz-danger/15 border-t border-b border-pz-danger text-pz-text text-[12px] px-3 py-2">
            <strong className="pz-display-h text-pz-danger">Banned.</strong>{" "}
            Reason: <code className="pz-mono">{p.banReason ?? "—"}</code>
            {p.banExpiresAt
              ? ` · expires ${relTime(p.banExpiresAt)}`
              : " · permanent"}
            {canBan && (
              <Button
                variant="ghost"
                size="sm"
                onClick={unban}
                disabled={busy === "__unban__"}
                className="ml-2"
              >
                {busy === "__unban__" ? "..." : "Unban"}
              </Button>
            )}
          </div>
        )}
      </Panel>

      {canNote && (
        <Panel title="Notes" sub={p.notes ? "SAVED" : "EMPTY"} dense>
          <div className="flex flex-col gap-2 p-3">
            <textarea
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              rows={4}
              maxLength={2000}
              placeholder="admin notes about this player…"
              className="bg-pz-bg-0 border border-pz-border-lo px-2 py-1 pz-mono text-xs text-pz-text placeholder:text-pz-muted focus:outline-none focus:border-pz-border-hi"
            />
            <div className="flex items-center justify-between">
              <span className="pz-mono text-[10px] text-pz-muted">
                {notesDraft.length} / 2000
              </span>
              <Button
                size="sm"
                onClick={saveNotes}
                disabled={busy === "__notes__"}
              >
                {busy === "__notes__" ? "..." : "Save notes"}
              </Button>
            </div>
          </div>
        </Panel>
      )}

      {canBan && !p.isBanned && (
        <Panel title="Actions" sub="ADMIN" dense>
          <div className="flex flex-col gap-2 p-3">
            {!banOpen ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setBanOpen(true)}
                className="self-start"
              >
                Ban player…
              </Button>
            ) : (
              <div className="flex flex-col gap-2 p-3 bg-pz-bg-1 border border-pz-border-lo">
                <div className="flex items-center gap-2 flex-wrap">
                  <label className="pz-label w-[90px]">REASON</label>
                  <input
                    value={banReason}
                    onChange={(e) => setBanReason(e.target.value)}
                    placeholder="required — shown to the banned user"
                    maxLength={200}
                    className="flex-1 min-w-[260px] bg-pz-bg-0 border border-pz-border-lo px-2 py-1 pz-mono text-xs text-pz-text focus:outline-none focus:border-pz-border-hi"
                  />
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <label className="pz-label w-[90px]">DURATION</label>
                  <select
                    value={banHours}
                    onChange={(e) => setBanHours(Number(e.target.value))}
                    className="bg-pz-bg-0 border border-pz-border-lo px-2 py-1 pz-mono text-xs text-pz-text focus:outline-none focus:border-pz-border-hi"
                  >
                    {DURATIONS.map((d) => (
                      <option key={d.hours} value={d.hours}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-2 justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setBanOpen(false);
                      setBanReason("");
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={submitBan}
                    disabled={!banReason.trim() || busy === "__ban__"}
                  >
                    {busy === "__ban__" ? "..." : "BAN"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Panel>
      )}

      <Panel
        title="Recent admin actions"
        sub={`${data.recentActions.length} ACTIONS`}
        dense
        bodyClassName="p-0"
      >
        {data.recentActions.length === 0 ? (
          <div className="p-6 text-center text-pz-muted text-xs">No actions yet.</div>
        ) : (
          <ul className="divide-y divide-pz-border-lo">
            {data.recentActions.map((a) => (
              <li key={a.id} className="p-2 pz-mono text-[11px]">
                <span className="text-pz-primary">{a.kind}</span>{" "}
                <span className="text-pz-text-dim">by {a.user?.username ?? "system"}</span>
                <span className="text-pz-muted"> · {relTime(a.createdAt)}</span>
                {typeof a.details === "object" && a.details && (
                  <pre className="mt-1 text-[10px] text-pz-muted overflow-x-auto">
                    {JSON.stringify(a.details, null, 2)}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {data.recentEvents.length > 0 && (
        <Panel
          title="World events (Phase 4 mod)"
          sub={`${data.recentEvents.length} EVENTS`}
          dense
          bodyClassName="p-0"
        >
          <ul className="divide-y divide-pz-border-lo">
            {data.recentEvents.map((e) => (
              <li key={e.id} className="p-2 pz-mono text-[11px]">
                <span className="text-pz-primary">{e.kind}</span>
                {e.region && <span className="text-pz-text-dim"> in {e.region}</span>}
                {e.x != null && e.y != null && (
                  <span className="text-pz-muted"> · ({e.x}, {e.y})</span>
                )}
                <span className="text-pz-muted"> · {relTime(e.ts)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
