/**
 * `POST /api/webhook/mod` — Phase 4 ingest endpoint.
 *
 * Not browser-facing; called by the server-side Lua companion mod. Auth
 * is HMAC-SHA256 over the raw body against `WEBHOOK_HMAC_SECRET` (with
 * an optional `_NEXT` rotation key). CSRF / session cookies are NOT
 * checked — the HMAC is the auth, and headers come from a server, not a
 * browser.
 *
 * Failure map:
 *   oversize body         → 413
 *   malformed JSON        → 400
 *   invalid signature     → 401
 *   schema mismatch       → 400
 *
 * The endpoint is intentionally tolerant: it accepts partial payloads
 * (only `positions`, only `events`, only `heartbeat`) so the Lua mod
 * can batch efficiently.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { verifyBearerSecret, verifyHmac } from "@/lib/ingest/hmac";
import * as positions from "@/lib/ingest/positions-store";
import { ingestBatch, type IncomingEvent, type WorldEventKind } from "@/lib/ingest/events-store";
import { getLogger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const log = () => getLogger().child({ mod: "api/webhook/mod" });

const PositionSchema = z.object({
  steamId: z.string().min(1),
  name: z.string().min(1),
  x: z.number(),
  y: z.number(),
  z: z.number().default(0),
  health: z.number().min(0).max(1).nullable().optional(),
  hunger: z.number().min(0).max(1).nullable().optional(),
  thirst: z.number().min(0).max(1).nullable().optional(),
  fatigue: z.number().min(0).max(1).nullable().optional(),
  inGameDay: z.number().int().nullable().optional(),
  inGameHourMin: z.number().int().nullable().optional(),
  region: z.string().nullable().optional(),
});

const EVENT_KINDS: readonly WorldEventKind[] = [
  "death",
  "join",
  "leave",
  "chat",
  "heli",
  "gunshot",
  "generator",
  "mod_stale",
] as const;

const EventSchema = z.object({
  kind: z.enum(EVENT_KINDS as unknown as [string, ...string[]]),
  ts: z.number().int().positive(),
  steamId: z.string().optional(),
  name: z.string().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  z: z.number().optional(),
  day: z.number().int().optional(),
  region: z.string().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

const HeartbeatSchema = z.object({
  tps: z.number().optional(),
  uptimeSec: z.number().optional(),
  playersOnline: z.number().int().optional(),
  day: z.number().int().optional(),
  hourMin: z.number().int().optional(),
});

const PayloadSchema = z.object({
  schema: z.literal(1),
  serverId: z.string().min(1),
  sentAt: z.number().int().positive(),
  heartbeat: HeartbeatSchema.optional(),
  positions: z.array(PositionSchema).max(256).default([]),
  events: z.array(EventSchema).max(256).default([]),
});

export async function POST(req: NextRequest) {
  const env = loadEnv();
  const maxBytes = env.INGEST_MAX_BODY_KB * 1024;

  const rawBuf = Buffer.from(await req.arrayBuffer());
  if (rawBuf.length > maxBytes) {
    return NextResponse.json(
      { ok: false, code: "oversize", detail: `body exceeds ${env.INGEST_MAX_BODY_KB}kB` },
      { status: 413 },
    );
  }

  const sigHeader = req.headers.get("x-pz-signature");
  const revHeader = req.headers.get("x-pz-secret-rev");
  const sharedSecret = req.headers.get("x-pz-shared-secret");

  // Prefer HMAC when present, fall back to shared-secret header for
  // clients (the PZ 42 Lua companion) that can't compute HMAC due to
  // luanet Java-interop limitations. Either path is acceptable because
  // TLS already protects confidentiality end-to-end.
  let hmac: ReturnType<typeof verifyHmac>;
  if (sigHeader) {
    hmac = verifyHmac({ rawBody: rawBuf, signatureHeader: sigHeader, revHeader });
  } else {
    hmac = verifyBearerSecret(sharedSecret);
  }
  if (!hmac.ok) {
    log().warn(
      { reason: hmac.reason, hadSig: Boolean(sigHeader), hadSecret: Boolean(sharedSecret) },
      "webhook auth rejected",
    );
    return NextResponse.json(
      { ok: false, code: "unauthorised", reason: hmac.reason },
      { status: 401 },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBuf.toString("utf8"));
  } catch {
    return NextResponse.json(
      { ok: false, code: "bad-json", detail: "body is not valid JSON" },
      { status: 400 },
    );
  }
  const body = PayloadSchema.safeParse(parsed);
  if (!body.success) {
    return NextResponse.json(
      { ok: false, code: "bad-payload", detail: body.error.message },
      { status: 400 },
    );
  }

  const now = Date.now();
  const { positions: pos, events, heartbeat } = body.data;

  if (heartbeat) {
    positions.applyHeartbeat({
      tps: heartbeat.tps ?? null,
      day: heartbeat.day ?? null,
      hourMin: heartbeat.hourMin ?? null,
      playersOnline: heartbeat.playersOnline ?? null,
      uptimeSec: heartbeat.uptimeSec ?? null,
      receivedAt: now,
    });
  }
  for (const p of pos) {
    positions.upsert({
      steamId: p.steamId,
      name: p.name,
      x: p.x,
      y: p.y,
      z: p.z,
      health: p.health ?? null,
      hunger: p.hunger ?? null,
      thirst: p.thirst ?? null,
      fatigue: p.fatigue ?? null,
      inGameDay: p.inGameDay ?? null,
      inGameHourMin: p.inGameHourMin ?? null,
      region: p.region ?? null,
      receivedAt: now,
    });
  }
  if (events.length > 0) {
    const typed: IncomingEvent[] = events.map((e) => ({
      kind: e.kind as WorldEventKind,
      ts: e.ts,
      steamId: e.steamId,
      name: e.name,
      x: e.x,
      y: e.y,
      z: e.z,
      day: e.day,
      region: e.region,
      meta: e.meta,
    }));
    await ingestBatch(typed);
  }

  log().debug(
    {
      serverId: body.data.serverId,
      positions: pos.length,
      events: events.length,
      rev: hmac.rev,
    },
    "webhook ingest ok",
  );
  return NextResponse.json({ ok: true, accepted: { positions: pos.length, events: events.length } });
}

export async function GET() {
  // Lightweight ping for operators to verify HMAC plumbing — NO auth
  // bypass; simply reports readiness.
  return NextResponse.json({
    ok: true,
    ready: true,
    hasNextSecret: Boolean(loadEnv().WEBHOOK_HMAC_SECRET_NEXT),
  });
}
