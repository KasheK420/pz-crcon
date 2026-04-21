"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Panel } from "@/components/pz/panel";
import { LiveDot } from "@/components/pz/live-dot";

interface LogLine {
  ts: number;
  text: string;
}

const MAX_LINES = 5000;

function buildWsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/ws`;
}

function classifyLine(line: string): { cls: string; tag: string } {
  if (/\bERROR\b|\bSEVERE\b|\bFAIL/i.test(line))
    return { cls: "text-pz-danger", tag: "ERR" };
  if (/\bWARN/i.test(line)) return { cls: "text-pz-amber", tag: "WRN" };
  if (/\bDEBUG/i.test(line)) return { cls: "text-pz-muted", tag: "DBG" };
  return { cls: "text-pz-text-dim", tag: "INF" };
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toISOString().substring(11, 23);
}

export function LogViewer() {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [filter, setFilter] = useState("");
  const [paused, setPaused] = useState(false);
  const [connected, setConnected] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    let cancelled = false;
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (cancelled) return;
      try {
        ws = new WebSocket(buildWsUrl());
      } catch (e) {
        console.warn("ws connect failed", e);
        retry = setTimeout(connect, 2000);
        return;
      }
      ws.onopen = () => {
        setConnected(true);
        ws?.send(
          JSON.stringify({ type: "subscribe", channel: "logs:server" })
        );
      };
      ws.onmessage = (ev) => {
        try {
          const m = JSON.parse(ev.data);
          if (m.channel !== "logs:server" || !m.data?.line) return;
          setLines((prev) => {
            // Don't grow unbounded — keep last MAX_LINES.
            const next = [
              ...prev,
              { ts: m.data.ts ?? Date.now(), text: m.data.line as string },
            ];
            if (next.length > MAX_LINES) next.splice(0, next.length - MAX_LINES);
            return next;
          });
        } catch (e) {
          console.warn("ws parse failed", e);
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (cancelled) return;
        retry = setTimeout(connect, 2000);
      };
      ws.onerror = () => {
        // close handler reconnects
      };
    }
    connect();
    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      ws?.close();
    };
  }, []);

  // Autoscroll unless paused.
  useEffect(() => {
    if (pausedRef.current) return;
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines]);

  const visible = useMemo(() => {
    if (!filter.trim()) return lines;
    const f = filter.toLowerCase();
    return lines.filter((l) => l.text.toLowerCase().includes(f));
  }, [lines, filter]);

  function exportText() {
    const blob = new Blob(
      [
        visible
          .map((l) => `${new Date(l.ts).toISOString()} ${l.text}`)
          .join("\n"),
      ],
      { type: "text/plain" }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pz-server-logs-${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <Panel
      title="Server Console"
      sub={`${visible.length} / ${lines.length} LINES`}
      right={
        <LiveDot
          variant={connected ? "live" : "down"}
          label={connected ? "STREAM" : "OFFLINE"}
        />
      }
      dense
      bodyClassName="p-0"
    >
      <div className="flex flex-col">
        <div className="flex items-center gap-2 flex-wrap p-3 border-b border-pz-border-lo bg-pz-bg-1">
          <div className="flex items-center gap-2 flex-1 min-w-[200px] bg-pz-bg-0 border border-pz-border-lo px-3 py-1.5">
            <span className="pz-label">FILTER</span>
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="bg-transparent border-none outline-none flex-1 pz-mono text-xs text-pz-text placeholder:text-pz-muted"
              placeholder="grep lines (case-insensitive)..."
            />
          </div>
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            className={`pz-pill hover:border-pz-border-hi ${paused ? "live" : ""}`}
            title={paused ? "Resume autoscroll" : "Pause autoscroll"}
          >
            {paused ? "PAUSED" : "LIVE"}
          </button>
          <button
            type="button"
            onClick={() => setLines([])}
            className="pz-pill hover:border-pz-border-hi"
          >
            CLEAR
          </button>
          <button
            type="button"
            onClick={exportText}
            className="pz-pill hover:border-pz-border-hi"
            disabled={visible.length === 0}
          >
            EXPORT
          </button>
        </div>

        <div
          ref={containerRef}
          onClick={() => setPaused(true)}
          className="bg-pz-bg-0 pz-mono text-[11.5px] leading-[1.4] overflow-y-auto"
          style={{ height: "65vh" }}
          role="log"
          aria-live="polite"
        >
          {visible.length === 0 ? (
            <div className="p-6 text-pz-muted text-xs">
              {filter
                ? "No lines match the filter."
                : connected
                  ? "Waiting for log lines from pz-server…"
                  : "Connecting to log stream…"}
            </div>
          ) : (
            visible.map((l, i) => {
              const c = classifyLine(l.text);
              return (
                <div
                  key={`${l.ts}-${i}`}
                  className="grid grid-cols-[80px_36px_1fr] gap-2 px-3 py-[2px] border-b border-pz-border-lo/40 hover:bg-pz-bg-1"
                >
                  <span className="text-pz-muted">{formatTime(l.ts)}</span>
                  <span className={`${c.cls} font-bold text-[10px]`}>
                    {c.tag}
                  </span>
                  <span className={`${c.cls} break-all whitespace-pre-wrap`}>
                    {l.text}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </Panel>
  );
}
