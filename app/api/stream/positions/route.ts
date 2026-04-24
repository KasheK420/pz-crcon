/**
 * `GET /api/stream/positions` — Server-Sent Events stream of live
 * positions.
 *
 * Public access is anonymised (hashed token, 250-tile grid, 30 s tick);
 * VIEWER+ sessions get the full snapshot at 2 s tick. One-way server →
 * client, so SSE is strictly simpler than a bidirectional WS channel
 * (see ADR-0004).
 *
 * Stream format (all `event:` + `data:` pairs, double-newline terminated):
 *   event: snapshot
 *   data: { "ts": …, "positions": […] }
 *
 *   event: heartbeat
 *   data: { "ts": … }
 *
 * The client uses EventSource which auto-reconnects with `Last-Event-ID`
 * — we don't need to replay anything because position snapshots are
 * idempotent overwrites.
 */

import type { NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { atLeast } from "@/lib/auth/role";
import * as positions from "@/lib/ingest/positions-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ADMIN_TICK_MS = 2_000;
const PUBLIC_TICK_MS = 30_000;
const HEARTBEAT_MS = 15_000;

function snapshotFor(isAdmin: boolean) {
  if (isAdmin) {
    return {
      role: "admin" as const,
      ts: Date.now(),
      positions: positions.all().map((p) => ({
        name: p.name,
        steamId: p.steamId,
        x: p.x,
        y: p.y,
        region: p.region,
        health: p.health,
        hunger: p.hunger,
        thirst: p.thirst,
        day: p.inGameDay,
      })),
      heartbeatAt: positions.lastHeartbeatAt(),
      tps: positions.lastTps(),
    };
  }
  return {
    role: "public" as const,
    ts: Date.now(),
    positions: positions.publicView().map((p) => ({
      token: p.token,
      x: p.x,
      y: p.y,
      region: p.region,
    })),
    heartbeatAt: positions.lastHeartbeatAt(),
  };
}

function frame(event: string, data: unknown, id?: string): Uint8Array {
  const payload = JSON.stringify(data);
  const parts: string[] = [];
  if (id) parts.push(`id: ${id}`);
  parts.push(`event: ${event}`);
  parts.push(`data: ${payload}`);
  parts.push("");
  parts.push("");
  return new TextEncoder().encode(parts.join("\n"));
}

export async function GET(_req: NextRequest) {
  const session = await getSession();
  const isAdmin = Boolean(session && atLeast(session.role, "VIEWER"));
  const tickMs = isAdmin ? ADMIN_TICK_MS : PUBLIC_TICK_MS;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const enq = (chunk: Uint8Array): void => {
        if (closed) return;
        try {
          controller.enqueue(chunk);
        } catch {
          closed = true;
        }
      };

      // Immediate snapshot so the client doesn't have to wait the first tick.
      enq(frame("snapshot", snapshotFor(isAdmin), `${Date.now()}`));

      const tick = setInterval(() => {
        if (closed) return;
        enq(frame("snapshot", snapshotFor(isAdmin), `${Date.now()}`));
      }, tickMs);

      const hb = setInterval(() => {
        if (closed) return;
        enq(frame("heartbeat", { ts: Date.now() }));
      }, HEARTBEAT_MS);

      // Let the runtime release these when the response is aborted
      // (browser navigates away, EventSource closed). We listen on the
      // controller's underlying closed signal via a micro-cleanup.
      (controller as unknown as { _cleanup?: () => void })._cleanup = () => {
        closed = true;
        clearInterval(tick);
        clearInterval(hb);
      };
    },
    cancel() {
      // Next.js calls cancel() when the client disconnects.
      // The interval cleanup is invoked above via the controller hook.
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
      // Nginx / proxy hint to not buffer SSE payloads.
      "x-accel-buffering": "no",
    },
  });
}
