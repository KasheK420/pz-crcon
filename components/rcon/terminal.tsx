"use client";

import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";
import { RCON_COMMANDS, findCommand } from "@/lib/rcon/commands";
import { parseRconLine } from "@/lib/rcon/parsers";
import { atLeast, type Role } from "@/lib/auth/role";
import { OutputLine, type OutputEntry } from "./output-line";

interface Props {
  role: Role;
}

export interface RconTerminalHandle {
  /** Inject text into the input box and focus it. */
  insertCommand: (text: string) => void;
}

function buildWsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/ws`;
}

export const RconTerminal = forwardRef<RconTerminalHandle, Props>(function RconTerminal(
  { role },
  ref,
) {
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const [output, setOutput] = useState<OutputEntry[]>([
    {
      kind: "info",
      text: "[SYS] Connected to RCON bridge. Type a command and press Enter.",
      ts: Date.now(),
    },
    {
      kind: "info",
      text: "[SYS] ↑/↓ cycles history · Tab autocompletes · click ↵ Insert in cheat sheet to paste examples.",
      ts: Date.now(),
    },
  ]);
  const [filter, setFilter] = useState("");
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const outRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(
    ref,
    () => ({
      insertCommand: (text: string) => {
        setInput(text);
        // Focus and place caret at end on next tick.
        setTimeout(() => {
          const el = inputRef.current;
          if (el) {
            el.focus();
            const len = text.length;
            try {
              el.setSelectionRange(len, len);
            } catch {
              // ignore unsupported input types
            }
          }
        }, 0);
      },
    }),
    [],
  );

  // Live updates from other admins via WS.
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
        return;
      }
      ws.onopen = () => {
        ws?.send(JSON.stringify({ type: "subscribe", channel: "rcon:output" }));
      };
      ws.onmessage = (ev) => {
        try {
          const m = JSON.parse(ev.data);
          if (m.channel !== "rcon:output" || !m.data) return;
          const { user, command, output: out } = m.data;
          const ts = Date.now();
          const lines: OutputEntry[] = [
            {
              kind: "user",
              text: `[${user}] > ${command}`,
              ts,
            },
            ...String(out)
              .split(/\r?\n/)
              .filter(Boolean)
              .map((l) => {
                const c = parseRconLine(l);
                return { kind: c.kind as OutputEntry["kind"], text: c.text, ts };
              }),
          ];
          setOutput((o) => [...o, ...lines]);
        } catch (e) {
          console.warn("ws parse failed", e);
        }
      };
      ws.onclose = () => {
        if (cancelled) return;
        retry = setTimeout(connect, 2000);
      };
      ws.onerror = () => {
        // close handler will re-queue the retry
      };
    }
    connect();

    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      ws?.close();
    };
  }, []);

  // Autoscroll to latest.
  useEffect(() => {
    if (outRef.current) outRef.current.scrollTop = outRef.current.scrollHeight;
  }, [output]);

  async function submit() {
    const cmd = input.trim();
    if (!cmd || pending) return;
    const head = cmd.split(/\s+/)[0];
    const spec = findCommand(head);
    if (spec && !atLeast(role, spec.requires)) {
      setOutput((o) => [
        ...o,
        {
          kind: "error",
          text: `✖ Command "${head}" requires ${spec.requires}+ role.`,
          ts: Date.now(),
        },
      ]);
      return;
    }

    setHistory((h) => [...h, cmd]);
    setHistIdx(-1);
    setInput("");
    // Optimistic echo — the WS broadcast will replay for other admins
    // but our own send completes via HTTP first.
    setOutput((o) => [...o, { kind: "user", text: `> ${cmd}`, ts: Date.now() }]);
    setPending(true);
    try {
      const res = await fetch("/api/rcon/execute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ command: cmd }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setOutput((o) => [
          ...o,
          {
            kind: "error",
            text: `✖ ${j.error ?? `HTTP ${res.status}`}`,
            ts: Date.now(),
          },
        ]);
        return;
      }
      const j = await res.json();
      const ts = Date.now();
      const lines: OutputEntry[] = String(j.output ?? "")
        .split(/\r?\n/)
        .filter(Boolean)
        .map((l) => {
          const c = parseRconLine(l);
          return { kind: c.kind as OutputEntry["kind"], text: c.text, ts };
        });
      if (lines.length === 0) {
        lines.push({ kind: "ok", text: "✔ OK (empty response)", ts });
      }
      setOutput((o) => [...o, ...lines]);
    } catch (e) {
      setOutput((o) => [
        ...o,
        {
          kind: "error",
          text: `✖ ${String(e)}`,
          ts: Date.now(),
        },
      ]);
    } finally {
      setPending(false);
    }
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (history.length === 0) return;
      const next = histIdx === -1 ? history.length - 1 : Math.max(0, histIdx - 1);
      setHistIdx(next);
      setInput(history[next]);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (histIdx === -1) return;
      const next = histIdx + 1;
      if (next >= history.length) {
        setHistIdx(-1);
        setInput("");
      } else {
        setHistIdx(next);
        setInput(history[next]);
      }
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const partial = input.trim();
      if (!partial) return;
      const match = RCON_COMMANDS.find(
        (c) => c.name.startsWith(partial) && atLeast(role, c.requires),
      );
      if (match) setInput(match.signature);
    }
  }

  const visible = filter
    ? output.filter((l) => l.text.toLowerCase().includes(filter.toLowerCase()))
    : output;

  // Live param hint: show signature for the command currently being typed.
  const head = input.trim().split(/\s+/)[0] ?? "";
  const headSpec = head ? findCommand(head) : undefined;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-1 min-w-[200px] bg-pz-bg-1 border border-pz-border-lo px-3 py-1.5 rounded-sm">
          <span className="pz-label">FILTER</span>
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="bg-transparent border-none outline-none flex-1 pz-mono text-xs text-pz-text placeholder:text-pz-muted"
            placeholder="narrow output..."
          />
        </div>
        <button
          type="button"
          onClick={() =>
            setOutput([
              {
                kind: "info",
                text: "[SYS] Output cleared.",
                ts: Date.now(),
              },
            ])
          }
          className="pz-pill hover:border-pz-border-hi"
        >
          CLEAR
        </button>
      </div>

      <div className="pz-terminal">
        <div className="pz-terminal-output" ref={outRef} role="log">
          {visible.map((line, i) => (
            <OutputLine key={i} entry={line} />
          ))}
        </div>
        <div className="pz-terminal-prompt">
          <span className="sigil">▶</span>
          <input
            ref={inputRef}
            className="pz-terminal-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            placeholder={
              pending
                ? "sending..."
                : 'type a command — e.g. players, chopper, save, servermsg "hi"...'
            }
            disabled={pending}
            autoFocus
          />
          <div className="flex gap-1">
            <kbd className="pz-kbd">↑↓</kbd>
            <kbd className="pz-kbd">Tab</kbd>
            <kbd className="pz-kbd">Enter</kbd>
          </div>
        </div>
        {headSpec && (
          <div
            className="pz-mono text-[10.5px] text-pz-muted px-3 py-1 border-t border-pz-border-lo bg-pz-bg-1"
            aria-live="polite"
          >
            <span className="text-pz-primary">{headSpec.name}</span>
            <span className="text-pz-text-dim"> · </span>
            <span>{headSpec.signature}</span>
            <span className="text-pz-text-dim"> · </span>
            <span className="uppercase">requires {headSpec.requires}+</span>
          </div>
        )}
      </div>
    </div>
  );
});
