"use client";

/**
 * `LifecyclePhaseBadge` — compact visual indicator of the server lifecycle
 * phase. Subscribes to the `server:lifecycle` WS channel for push updates
 * and falls back to polling `/api/admin/server/state` every 5s if the WS
 * connection is not available. The fallback also runs on first mount so
 * the badge has a non-null initial state before the WS "subscribed" ack.
 *
 * Shown phases: idle / warning / saving / stopping / starting.
 * `warning` renders a live countdown (derived from `at` + `detail="30s"`).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface LifecycleSnapshot {
  phase: "idle" | "warning" | "saving" | "stopping" | "starting";
  detail?: string;
  at?: number;
}

function buildWsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/ws`;
}

function phaseClasses(phase: LifecycleSnapshot["phase"]): string {
  switch (phase) {
    case "idle":
      return "bg-pz-bg-1 text-pz-text border-pz-border-lo";
    case "warning":
      return "bg-pz-warn/10 text-pz-warn border-pz-warn/40";
    case "saving":
      return "bg-pz-accent/10 text-pz-accent border-pz-accent/40";
    case "stopping":
      return "bg-pz-danger/10 text-pz-danger border-pz-danger/40";
    case "starting":
      return "bg-pz-ok/10 text-pz-ok border-pz-ok/40";
    default:
      return "bg-pz-bg-1 text-pz-text border-pz-border-lo";
  }
}

function parseWarningSeconds(detail?: string): number | null {
  if (!detail) return null;
  const m = detail.match(/^(\d+)s$/);
  if (!m) return null;
  return Number(m[1]);
}

interface Props {
  className?: string;
  onSnapshot?: (s: LifecycleSnapshot) => void;
}

export function LifecyclePhaseBadge({ className, onSnapshot }: Props) {
  const [snap, setSnap] = useState<LifecycleSnapshot>({ phase: "idle" });
  const [wsConnected, setWsConnected] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const onSnapshotRef = useRef(onSnapshot);
  onSnapshotRef.current = onSnapshot;

  const emit = useCallback((s: LifecycleSnapshot) => {
    setSnap(s);
    onSnapshotRef.current?.(s);
  }, []);

  // HTTP fallback — runs on mount and then every 5s when the WS is down.
  useEffect(() => {
    let cancelled = false;
    async function pull() {
      try {
        const res = await fetch("/api/admin/server/state", {
          credentials: "same-origin",
        });
        if (!res.ok) return;
        const j = await res.json();
        if (cancelled || !j.ok) return;
        emit({
          phase: j.lifecyclePhase,
          detail: j.lifecycleDetail,
          at: j.ts,
        });
      } catch {
        // transient fetch errors are fine; WS or next poll will recover.
      }
    }
    void pull();
    const id = window.setInterval(() => {
      if (!wsConnected) void pull();
    }, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [wsConnected, emit]);

  // WebSocket subscription to `server:lifecycle`.
  useEffect(() => {
    let cancelled = false;
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (cancelled) return;
      try {
        ws = new WebSocket(buildWsUrl());
      } catch {
        return;
      }
      ws.onopen = () => {
        ws?.send(
          JSON.stringify({ type: "subscribe", channel: "server:lifecycle" }),
        );
      };
      ws.onmessage = (ev) => {
        try {
          const m = JSON.parse(ev.data);
          if (m.type === "subscribed" && m.channel === "server:lifecycle") {
            setWsConnected(true);
            return;
          }
          if (m.channel !== "server:lifecycle" || !m.data) return;
          emit({
            phase: m.data.phase,
            detail: m.data.detail,
            at: m.data.at,
          });
        } catch {
          // ignore malformed frames
        }
      };
      ws.onclose = () => {
        setWsConnected(false);
        if (cancelled) return;
        retry = setTimeout(connect, 2000);
      };
      ws.onerror = () => {
        // close handler re-queues retry
      };
    }
    connect();
    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      ws?.close();
    };
  }, [emit]);

  // Tick every second while in warning phase so the countdown renders live.
  useEffect(() => {
    if (snap.phase !== "warning") return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [snap.phase]);

  const display = useMemo(() => {
    if (snap.phase === "warning") {
      const total = parseWarningSeconds(snap.detail);
      if (total !== null && snap.at) {
        const elapsed = Math.max(0, Math.floor((now - snap.at) / 1000));
        const remaining = Math.max(0, total - elapsed);
        return { label: "warning", extra: `${remaining}s` };
      }
      return { label: "warning", extra: snap.detail ?? "" };
    }
    if (snap.phase === "idle") {
      if (snap.detail?.startsWith("start-failed")) {
        return { label: "idle", extra: "start-failed" };
      }
      if (snap.detail === "force-stopped") {
        return { label: "idle", extra: "force-stopped" };
      }
      return { label: "idle", extra: "" };
    }
    return { label: snap.phase, extra: snap.detail ?? "" };
  }, [snap, now]);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 pz-mono text-[10.5px] uppercase tracking-wide",
        phaseClasses(snap.phase),
        className,
      )}
      title={snap.detail ?? snap.phase}
    >
      <span className="font-semibold">{display.label}</span>
      {display.extra && <span className="text-pz-text-dim">· {display.extra}</span>}
    </span>
  );
}
