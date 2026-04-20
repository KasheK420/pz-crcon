"use client";

import { useEffect, useState } from "react";
import { Panel } from "@/components/pz/panel";
import { LiveDot } from "@/components/pz/live-dot";

interface AdminAction {
  id: string;
  kind: string;
  target: string | null;
  details: unknown;
  createdAt: string;
  user: { username: string; discordId: string };
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
  return `${Math.floor(ms / 86_400_000)}d`;
}

function kindBadge(kind: string): { label: string; cls: string } {
  if (kind.startsWith("rcon_")) return { label: "RCON", cls: "green" };
  if (kind === "player_kick") return { label: "KICK", cls: "amber" };
  if (kind === "player_ban") return { label: "BAN", cls: "red" };
  if (kind === "player_unban") return { label: "UNBAN", cls: "green" };
  if (kind.startsWith("quick_")) return { label: "QUICK", cls: "amber" };
  return { label: "ACT", cls: "" };
}

export function ActivityFeed() {
  const [actions, setActions] = useState<AdminAction[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/admin/actions", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = await res.json();
        if (!cancelled) {
          setActions(j.actions);
          setError(false);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    }
    load();
    const id = setInterval(load, 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <Panel
      title="Activity Feed"
      sub="LAST 50"
      right={<LiveDot variant={error ? "down" : "live"} />}
      dense
    >
      <div className="max-h-[440px] overflow-y-auto">
        {actions === null && (
          <div className="p-4 text-pz-muted text-xs">Loading…</div>
        )}
        {actions && actions.length === 0 && (
          <div className="p-4 text-pz-muted text-xs">
            No admin actions recorded yet.
          </div>
        )}
        {actions?.map((a) => {
          const b = kindBadge(a.kind);
          const cmd =
            (a.details as { command?: string } | null)?.command ?? a.kind;
          return (
            <div
              key={a.id}
              className="grid grid-cols-[60px_60px_1fr_auto] gap-2 items-baseline px-3 py-2 border-b border-pz-border-lo text-[12px]"
            >
              <span className="pz-mono text-pz-muted text-[10.5px]">
                {relativeTime(a.createdAt)}
              </span>
              <span className={`pz-badge ${b.cls}`}>{b.label}</span>
              <span className="text-pz-text-dim min-w-0">
                <span className="text-pz-text font-medium">{a.user.username}</span>{" "}
                <span className="pz-mono text-pz-muted text-[11px] break-all">
                  {cmd}
                </span>
              </span>
              {a.target && (
                <span className="pz-mono text-[10px] text-pz-muted">
                  → {a.target}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
