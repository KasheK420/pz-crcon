"use client";

import { useEffect, useState } from "react";
import { StatCard } from "@/components/pz/stat-card";

interface HistoryView {
  samples: Array<{ ts: number; count: number }>;
  intervalMs: number;
  windowMs: number;
  capacity: number;
}

interface Status {
  online: boolean;
  serverName: string;
  players: { count: number; names: string[] };
  uptimeSec: number;
  uptimeSource: "rcon-connect" | "process-start";
  tps: number | null;
  inGameDay?: number | null;
  inGameHourMin?: number | null;
  luaModFresh?: boolean;
  luaModHeartbeatAt?: number | null;
  history?: HistoryView;
}

function formatInGameTime(day: number | null | undefined, hourMin: number | null | undefined): string {
  if (day == null && hourMin == null) return "—";
  const parts: string[] = [];
  if (day != null) parts.push(`Day ${day}`);
  if (hourMin != null) {
    const h = Math.floor(hourMin / 60);
    const m = hourMin % 60;
    parts.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  }
  return parts.join(" · ");
}

interface ContainerStat {
  name: string;
  running: boolean;
  memBytes: number;
  memLimitBytes: number;
  cpuPercent: number;
  available: boolean;
  reason?: string;
}

interface HostStats {
  pzServer: ContainerStat;
  pzCrcon: ContainerStat;
  ts: number;
}

function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function formatBytes(b: number): string {
  if (!b) return "0 MB";
  const mb = b / 1_048_576;
  if (mb < 1024) return `${mb.toFixed(0)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

function memVariant(s: ContainerStat): "default" | "ok" | "warn" | "danger" {
  if (!s.available || !s.running) return "default";
  if (!s.memLimitBytes) return "default";
  const pct = (s.memBytes / s.memLimitBytes) * 100;
  if (pct > 90) return "danger";
  if (pct > 75) return "warn";
  return "ok";
}

function Sparkline({ data }: { data: number[] }) {
  if (data.length === 0) return null;
  const max = Math.max(1, ...data);
  const w = 120;
  const h = 28;
  const step = w / Math.max(1, data.length - 1);
  const pts = data.map((v, i) => `${i * step},${h - (v / max) * h}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} className="mt-1">
      <polyline
        fill="none"
        stroke="var(--color-pz-primary)"
        strokeWidth="1"
        points={pts}
      />
    </svg>
  );
}

function ContainerCard({
  label,
  s,
}: {
  label: string;
  s: ContainerStat | undefined;
}) {
  if (!s || !s.available) {
    return (
      <StatCard
        label={label}
        value="—"
        foot={s?.reason ?? "docker socket unavailable"}
      />
    );
  }
  if (!s.running) {
    return (
      <StatCard label={label} value="STOPPED" foot={s.name} variant="danger" />
    );
  }
  const memPct = s.memLimitBytes
    ? Math.round((s.memBytes / s.memLimitBytes) * 100)
    : 0;
  return (
    <StatCard
      label={label}
      value={formatBytes(s.memBytes)}
      foot={
        <span>
          <span className="pz-mono">{s.cpuPercent.toFixed(1)}% CPU</span>
          {s.memLimitBytes ? <span className="pz-mono"> · {memPct}% of {formatBytes(s.memLimitBytes)}</span> : null}
        </span>
      }
      variant={memVariant(s)}
    />
  );
}

export function StatusCards() {
  const [status, setStatus] = useState<Status | null>(null);
  const [hostStats, setHostStats] = useState<HostStats | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [statusRes, hostRes] = await Promise.all([
          fetch("/api/status", { cache: "no-store" }),
          fetch("/api/admin/host-stats", { cache: "no-store" }),
        ]);
        if (!statusRes.ok) throw new Error(`HTTP ${statusRes.status}`);
        const j = await statusRes.json();
        if (!cancelled) {
          setStatus(j);
          setError(false);
        }
        if (hostRes.ok) {
          const h = await hostRes.json();
          if (!cancelled) setHostStats(h);
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

  // 24 h ring buffer from /api/status. If the server just started the
  // buffer will be empty; render a flat line at the current count until
  // enough 5-min samples accumulate.
  const samples = status?.history?.samples ?? [];
  const sparkData =
    samples.length > 1
      ? samples.map((s) => s.count)
      : Array(12).fill(status?.players.count ?? 0);
  const sparkFoot =
    samples.length > 1
      ? `${samples.length} / ${status?.history?.capacity ?? 288} samples · 5-min tick`
      : "warming up · needs 5+ min of polls";

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Server Status"
          value={
            status?.online
              ? "ONLINE"
              : error || status === null
                ? "—"
                : "OFFLINE"
          }
          foot={status?.online ? "RCON responding" : "RCON unreachable"}
          variant={
            status?.online ? "ok" : status === null ? "default" : "danger"
          }
        />
        <StatCard
          label="Players Online"
          value={status?.players.count ?? "—"}
          foot={
            status?.players.names.length
              ? `${status.players.names.slice(0, 3).join(", ")}${status.players.names.length > 3 ? "…" : ""}`
              : "no one connected"
          }
        />
        <StatCard
          label="Uptime"
          value={status ? formatUptime(status.uptimeSec) : "—"}
          foot={
            status
              ? status.uptimeSource === "rcon-connect"
                ? "since first RCON connect"
                : "since process start"
              : "approx"
          }
        />
        <StatCard
          label="TPS"
          value={status?.tps != null ? status.tps.toFixed(1) : "—"}
          foot={
            status?.tps != null
              ? status.luaModFresh
                ? "live from Lua mod"
                : "approx · scraped from logs"
              : "no TPS reading yet"
          }
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <ContainerCard label="pz-server MEM" s={hostStats?.pzServer} />
        <ContainerCard label="pz-crcon MEM" s={hostStats?.pzCrcon} />
        <StatCard
          label="In-game Time"
          value={formatInGameTime(status?.inGameDay, status?.inGameHourMin)}
          foot={
            status?.luaModFresh
              ? "live · Lua mod heartbeat"
              : "install companion mod — see docs/lua-mod-install.md"
          }
        />
        <StatCard
          label="Weather"
          value="—"
          foot={
            status?.luaModFresh
              ? "weather field reserved · Lua mod not reporting it yet"
              : "install companion mod — see docs/lua-mod-install.md"
          }
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-1 gap-3">
        <div className="pz-stat">
          <div className="pz-label">24h Players</div>
          <div className="v">
            <Sparkline data={sparkData} />
          </div>
          <div className="foot">{sparkFoot}</div>
        </div>
      </div>
    </div>
  );
}
