/**
 * In-memory live-positions store.
 *
 * Source of truth for "where is every online player right now"; fed by
 * the Lua-mod webhook, read by SSE / REST endpoints.
 *
 * Scope:
 *   - single-process only — the WS server owns the Map
 *   - entries older than STALE_MS are evicted on every access (not a timer)
 *
 * Design note: we deliberately do NOT persist positions to the DB. A
 * running player at 2 s ticks emits ~43 k rows/day; useless to store and
 * expensive to query. Persistence is limited to `WorldEvent` (deaths,
 * joins, helis).
 */

import { getLogger } from "@/lib/logger";

const log = () => getLogger().child({ mod: "ingest/positions" });

const STALE_MS = 120_000;

export interface Position {
  steamId: string;
  name: string;
  x: number;
  y: number;
  z: number;
  health: number | null;
  hunger: number | null;
  thirst: number | null;
  fatigue: number | null;
  inGameDay: number | null;
  inGameHourMin: number | null;
  region: string | null;
  receivedAt: number;
}

export interface PublicPosition {
  /** Hashed/rotating token that stays stable within a tick window. */
  token: string;
  /** Coords snapped to PUBLIC_GRID_SIZE. */
  x: number;
  y: number;
  region: string | null;
  receivedAt: number;
}

const PUBLIC_GRID_SIZE = 250;

const _positions = new Map<string, Position>();
let _lastHeartbeatAt: number | null = null;
let _lastTps: number | null = null;
let _lastDay: number | null = null;
let _lastHourMin: number | null = null;
let _lastPlayersOnline: number | null = null;
let _lastUptimeSec: number | null = null;

// Hourly-rotating salt for public hashing. Prevents a stalker from
// correlating the same public token across long sessions while keeping
// short-term path continuity readable.
let _publicSaltHour = -1;
let _publicSalt = "";

function rotateSaltIfNeeded(): void {
  const hour = Math.floor(Date.now() / 3_600_000);
  if (hour === _publicSaltHour) return;
  _publicSaltHour = hour;
  _publicSalt = Math.random().toString(36).slice(2);
}

function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  // 32-bit unsigned then base36 → short, stable, non-reversible-ish
  return (h >>> 0).toString(36);
}

export function upsert(p: Position): void {
  _positions.set(p.steamId, p);
}

export function applyHeartbeat(h: {
  tps?: number | null;
  day?: number | null;
  hourMin?: number | null;
  playersOnline?: number | null;
  uptimeSec?: number | null;
  receivedAt: number;
}): void {
  _lastHeartbeatAt = h.receivedAt;
  if (h.tps !== undefined && h.tps !== null) _lastTps = h.tps;
  if (h.day !== undefined && h.day !== null) _lastDay = h.day;
  if (h.hourMin !== undefined && h.hourMin !== null) _lastHourMin = h.hourMin;
  if (h.playersOnline !== undefined && h.playersOnline !== null)
    _lastPlayersOnline = h.playersOnline;
  if (h.uptimeSec !== undefined && h.uptimeSec !== null) _lastUptimeSec = h.uptimeSec;
}

function prune(now: number): void {
  for (const [k, v] of _positions) {
    if (now - v.receivedAt > STALE_MS) _positions.delete(k);
  }
}

export function all(): Position[] {
  prune(Date.now());
  return Array.from(_positions.values());
}

export function byId(steamId: string): Position | null {
  prune(Date.now());
  return _positions.get(steamId) ?? null;
}

export function publicView(): PublicPosition[] {
  prune(Date.now());
  rotateSaltIfNeeded();
  const out: PublicPosition[] = [];
  for (const p of _positions.values()) {
    const token = djb2(`${_publicSalt}:${p.steamId}`);
    out.push({
      token,
      x: Math.floor(p.x / PUBLIC_GRID_SIZE) * PUBLIC_GRID_SIZE,
      y: Math.floor(p.y / PUBLIC_GRID_SIZE) * PUBLIC_GRID_SIZE,
      region: p.region,
      receivedAt: p.receivedAt,
    });
  }
  return out;
}

export function lastHeartbeatAt(): number | null {
  return _lastHeartbeatAt;
}

export function lastTps(): number | null {
  return _lastTps;
}

export interface HeartbeatSnapshot {
  at: number | null;
  tps: number | null;
  day: number | null;
  hourMin: number | null;
  playersOnline: number | null;
  uptimeSec: number | null;
  /** True when we've received a heartbeat in the last 2 minutes. */
  fresh: boolean;
}

const FRESH_MS = 120_000;

export function heartbeat(): HeartbeatSnapshot {
  const fresh =
    _lastHeartbeatAt !== null && Date.now() - _lastHeartbeatAt < FRESH_MS;
  return {
    at: _lastHeartbeatAt,
    tps: _lastTps,
    day: _lastDay,
    hourMin: _lastHourMin,
    playersOnline: _lastPlayersOnline,
    uptimeSec: _lastUptimeSec,
    fresh,
  };
}

/** Test / admin helper. Does NOT fire events. */
export function reset(): void {
  _positions.clear();
  _lastHeartbeatAt = null;
  _lastTps = null;
  _lastDay = null;
  _lastHourMin = null;
  _lastPlayersOnline = null;
  _lastUptimeSec = null;
  log().warn("positions store reset");
}
