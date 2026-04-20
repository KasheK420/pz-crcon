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
      ws.on("close", () => clients.delete(ws));
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
      } else {
        ws.send(JSON.stringify({ type: "denied", channel: msg.channel }));
      }
    } else if (msg.type === "unsubscribe" && msg.channel) {
      state.subs.delete(msg.channel);
    }
  } catch (e) {
    log().warn({ err: e }, "bad ws message");
  }
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
}
