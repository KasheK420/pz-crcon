import { WebSocketServer, type WebSocket } from "ws";
import type { Server as HttpServer } from "node:http";
import { getLogger } from "@/lib/logger";
import { identifyFromCookie, type WsIdentity } from "@/lib/ws/auth";
import { canSubscribe, type Channel } from "@/lib/ws/channels";
import { loadEnv } from "@/lib/env";

const log = () => getLogger().child({ mod: "ws" });

interface ClientState {
  identity: WsIdentity | null;
  subs: Set<Channel>;
}

const clients = new Map<WebSocket, ClientState>();

type SubChangeListener = (channel: Channel, count: number) => void;
const subListeners = new Set<SubChangeListener>();

/**
 * Subscribe to channel-subscriber-count changes. The callback fires
 * whenever a client subscribes or unsubscribes (or drops while
 * holding subs). `count` is the new subscriber count for the channel.
 *
 * Used by long-running stream backends (like the docker-logs tailer)
 * to start work on the first subscriber and stop on the last.
 */
export function onSubscriberChange(fn: SubChangeListener): () => void {
  subListeners.add(fn);
  return () => subListeners.delete(fn);
}

function countSubs(channel: Channel): number {
  let n = 0;
  for (const state of clients.values()) {
    if (state.subs.has(channel)) n++;
  }
  return n;
}

function notify(channel: Channel): void {
  const c = countSubs(channel);
  for (const fn of subListeners) {
    try {
      fn(channel, c);
    } catch {
      // listener errors must not break ws traffic
    }
  }
}

export function attachWs(httpServer: HttpServer): WebSocketServer {
  const env = loadEnv();
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", async (req, socket, head) => {
    if (!req.url?.startsWith("/api/ws")) return;
    const identity = await identifyFromCookie(req.headers.cookie);
    wss.handleUpgrade(req, socket, head, (ws) => {
      clients.set(ws, { identity, subs: new Set() });
      ws.send(JSON.stringify({ type: "hello", role: identity?.role ?? null }));
      log().info({ role: identity?.role ?? "anon" }, "ws connected");

      ws.on("message", (raw) => onMessage(ws, raw.toString()));
      ws.on("close", () => {
        const state = clients.get(ws);
        clients.delete(ws);
        // Re-notify any channels this client was subscribed to so that
        // backends can shut down if subscriber count is now zero.
        if (state) {
          for (const ch of state.subs) notify(ch);
        }
      });
    });
  });

  setInterval(() => {
    for (const ws of clients.keys()) {
      if (ws.readyState === ws.OPEN) ws.ping();
    }
  }, env.WS_HEARTBEAT_SEC * 1000);

  return wss;
}

function onMessage(ws: WebSocket, raw: string): void {
  try {
    const msg = JSON.parse(raw) as { type: string; channel?: Channel };
    const state = clients.get(ws)!;
    if (msg.type === "subscribe" && msg.channel) {
      if (canSubscribe(msg.channel, state.identity?.role ?? null)) {
        state.subs.add(msg.channel);
        ws.send(JSON.stringify({ type: "subscribed", channel: msg.channel }));
        notify(msg.channel);
      } else {
        ws.send(JSON.stringify({ type: "denied", channel: msg.channel }));
      }
    } else if (msg.type === "unsubscribe" && msg.channel) {
      if (state.subs.delete(msg.channel)) {
        notify(msg.channel);
      }
    }
  } catch (e) {
    log().warn({ err: e }, "bad ws message");
  }
}

type LocalListener = (data: unknown) => void | Promise<void>;
const localListeners = new Map<Channel, Set<LocalListener>>();

/**
 * Subscribe to `publish()` calls in-process, without going through the
 * WebSocket. Used by server-side consumers (Discord notifier, analytics,
 * log persistence) that want to react to events without the
 * browser-facing channel plumbing.
 */
export function subscribeLocal(channel: Channel, fn: LocalListener): () => void {
  let set = localListeners.get(channel);
  if (!set) {
    set = new Set();
    localListeners.set(channel, set);
  }
  set.add(fn);
  return () => {
    set?.delete(fn);
  };
}

/** Publish an event to all clients subscribed to the channel. */
export function publish(channel: Channel, data: unknown): void {
  const envelope = JSON.stringify({
    channel,
    data,
    ts: Date.now(),
  });
  for (const [ws, state] of clients.entries()) {
    if (state.subs.has(channel) && ws.readyState === ws.OPEN) {
      ws.send(envelope);
    }
  }
  const locals = localListeners.get(channel);
  if (locals && locals.size > 0) {
    for (const fn of locals) {
      try {
        void fn(data);
      } catch (e) {
        log().warn({ err: e, channel }, "local listener threw");
      }
    }
  }
}
