/**
 * World-event persistence + fan-out.
 *
 * Every event that arrives through the Lua-mod webhook is routed here.
 * Events that matter historically (deaths, joins, helicopter, generator)
 * are written to the `WorldEvent` table; chat is gated by
 * `INGEST_STORE_CHAT=true` because it's privacy-sensitive and low-value
 * to persist. Every event — persisted or not — is also published on the
 * `events:admin` WS channel so the admin map + Discord notifier light up
 * in real time.
 */

import { prisma } from "@/lib/db/client";
import { publish } from "@/lib/ws/server";
import { loadEnv } from "@/lib/env";
import { getLogger } from "@/lib/logger";

const log = () => getLogger().child({ mod: "ingest/events" });

export type WorldEventKind =
  | "death"
  | "join"
  | "leave"
  | "chat"
  | "heli"
  | "gunshot"
  | "generator"
  | "mod_stale";

export interface IncomingEvent {
  kind: WorldEventKind;
  ts: number;
  steamId?: string;
  name?: string;
  x?: number;
  y?: number;
  z?: number;
  day?: number;
  region?: string;
  meta?: Record<string, unknown>;
}

function shouldPersist(kind: WorldEventKind): boolean {
  if (kind === "chat") return loadEnv().INGEST_STORE_CHAT;
  return true;
}

export async function ingestEvent(e: IncomingEvent): Promise<void> {
  // Fan-out first — never let a DB hiccup swallow a realtime signal.
  try {
    publish("events:admin", {
      kind: `world.${e.kind}`,
      event: e,
      at: e.ts ?? Date.now(),
    });
  } catch (err) {
    log().warn({ err, kind: e.kind }, "events:admin publish failed");
  }

  if (!shouldPersist(e.kind)) return;
  try {
    await prisma.worldEvent.create({
      data: {
        kind: e.kind,
        player: e.name ?? null,
        region: e.region ?? null,
        x: e.x != null ? Math.round(e.x) : null,
        y: e.y != null ? Math.round(e.y) : null,
        z: e.z != null ? Math.round(e.z) : null,
        day: e.day ?? null,
        metaJson: (e.meta ?? null) as never,
        ts: e.ts ? new Date(e.ts) : new Date(),
      },
    });
  } catch (err) {
    log().error({ err, kind: e.kind }, "worldEvent insert failed");
  }
}

export async function ingestBatch(events: IncomingEvent[]): Promise<void> {
  for (const e of events) {
    // Sequential to keep the `events:admin` ordering stable for the UI.
    // Throughput target (3–5 events/sec max) doesn't need parallelism.
    await ingestEvent(e);
  }
}

export interface ListEventsOpts {
  kind?: WorldEventKind | WorldEventKind[];
  from?: Date;
  to?: Date;
  limit?: number;
  cursorId?: string;
}

export async function listEvents(opts: ListEventsOpts = {}) {
  const where: {
    kind?: { in: WorldEventKind[] } | WorldEventKind;
    ts?: { gte?: Date; lte?: Date };
  } = {};
  if (opts.kind) {
    where.kind = Array.isArray(opts.kind) ? { in: opts.kind } : opts.kind;
  }
  if (opts.from || opts.to) {
    where.ts = {};
    if (opts.from) where.ts.gte = opts.from;
    if (opts.to) where.ts.lte = opts.to;
  }
  const rows = await prisma.worldEvent.findMany({
    where,
    orderBy: [{ ts: "desc" }, { id: "desc" }],
    take: Math.min(opts.limit ?? 100, 500),
    ...(opts.cursorId
      ? { cursor: { id: opts.cursorId }, skip: 1 }
      : {}),
  });
  return rows;
}
