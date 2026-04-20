"use client";

import { useEffect, useState } from "react";
import { StatCard } from "@/components/pz/stat-card";

interface Status {
  online: boolean;
  serverName: string;
  players: { count: number; names: string[] };
  uptimeSec: number;
}

function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
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

export function StatusCards() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/status", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = await res.json();
        if (!cancelled) {
          setStatus(j);
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

  // Phase 1: empty sparkline (no historical store yet).
  const sparkData = Array(12).fill(status?.players.count ?? 0);

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <StatCard
        label="Server Status"
        value={
          status?.online ? "ONLINE" : error || status === null ? "—" : "OFFLINE"
        }
        foot={status?.online ? "RCON responding" : "RCON unreachable"}
        variant={status?.online ? "ok" : status === null ? "default" : "danger"}
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
        foot="approx · since process start"
      />
      <StatCard
        label="24h Players"
        value={<Sparkline data={sparkData} />}
        foot="historical store · Phase 2"
        variant="default"
      />
    </div>
  );
}
