# Phase 4 — Live Player Positions & Lua Companion Mod

> **Status:** brainstorm / design draft. Does **not** supersede
> `2026-04-20-pz-crcon-design.md` (the master spec) — it refines the
> parts of Phase 4 the master spec intentionally left open.

## 1. Context

The master spec (§6 WebSocket, §7 Lua mod protocol, §8 Phase 4) fixed
the high-level architecture for live player positions:

- Push model from a server-side Lua mod (not polling).
- HMAC-signed HTTP POST to `/api/webhook/mod`, with timestamp + nonce
  replay protection.
- A payload envelope `v1` with `heartbeat` and an `events[]` array
  containing `join`, `death`, `chat`, `pos`, `helicopter` event kinds.
- A WebSocket channel `players:positions` that feeds admin (full) and
  public (anonymized) clients.
- Phase 4 delivers: mod scaffold + Workshop publish, HMAC ingestion,
  live positions, live event feed, Discord notifications.

Phases 1 → 1.6 already shipped:

- `components/map/knox-map.tsx` — Leaflet + community Knox tiles
  (`pzmap.crash-override.net`) + TIS fallback, CRS.Simple, world
  bounds `10224 × 10576`, marker layer ready.
- `app/api/players/positions/route.ts` — public endpoint that currently
  returns RCON-derived names clustered on a single placeholder point
  with `approximate: true`. Real coordinates are gated on this phase.

This document fills the gaps the master spec did not resolve and
proposes a concrete, implementable shape for Phase 4.

## 2. Goals

- Real per-player coordinates on the Knox map, refreshing fast enough
  to feel live but without burning the PZ server's main thread.
- A companion Lua mod small enough to read in one sitting, robust
  against the panel being offline, and portable between PZ B41 and B42.
- Public map anonymization that prevents real-time griefing /
  stalking while still being fun to watch.
- Clear separation between Phase 4 (MVP of live data) and later work
  (trails, heatmap, 24h replay, mobile push).

## 3. Non-goals

- Rewriting Phase 1–1.6 code.
- Self-hosting Knox tiles. (Tracked as a separate Phase 2 task in the
  master spec; we continue using `pzmap.crash-override.net` as a
  guest, with the official TIS fallback.)
- Multi-server fan-in. `pz-crcon` v0.x is single-tenant; the design
  permits multi-server later but does not implement it now.
- Client-side player-submitted mods (only the server-side companion
  mod is in scope).

## 4. Open questions the master spec did not resolve

| # | Question | Master spec says | Gap |
|---|----------|------------------|-----|
| Q1 | How often does the Lua mod emit `pos` events? | `heartbeat_seconds=10` config | Doesn't specify whether `pos` piggybacks on the heartbeat or runs on its own cadence |
| Q2 | Where does the ingest endpoint write snapshots? | Not specified | DB write per event vs. in-memory cache vs. both |
| Q3 | How is "anonymized" defined for the public map? | One word: "anonymized" | Concrete policy (fuzzy coords? hide names? rate-cap?) |
| Q4 | Frontend transport for the `players:positions` channel? | WS chosen in §14 | WS works, but SSE is simpler for one-way position stream; reconfirm |
| Q5 | Which Lua event hook drives `pos` emission? | Not specified | `OnTick` / `OnPlayerUpdate` / `EveryOneMinute` / custom timer all viable, with wildly different cost |
| Q6 | Degraded mode when Lua mod stops posting? | Not specified | Frontend needs a "stale" state, not stale data pretending to be fresh |
| Q7 | What's in Phase 4 vs. later phases? (trails, heatmap, deaths markers, replay) | Phase 4 lists positions + event feed + Discord notifs | No explicit scope boundary with Phase 5+ |

## 5. Decisions (recommended)

### 5.1 Tick rate and event mix

- **Positions:** every **5 s** from the Lua mod. One `pos` event per
  online player per tick, batched into one HTTP POST.
- **Heartbeat:** every **30 s**. Carries `uptimeSec`, `tps`,
  `playersOnline`, `day`, in-game time. Keeps the ingest route aware
  the mod is alive even if no player positions changed.
- **Events (`join`, `death`, `chat`, `helicopter`):** emitted as they
  happen, flushed with the next tick (max 5 s latency).
- **Flush rule:** the mod sends a POST every tick even if `pos` is
  empty, so the server always knows the mod is live.
- **PZ-side hook:** `Events.OnTick` with an internal `getTimestampMs()`
  timer gate. `OnTick` fires ~30–60× per second, but we only do work
  when `now - lastFlush >= 5000`. Avoids depending on the coarse
  `EveryOneMinute` event and doesn't use per-player `OnPlayerUpdate`
  (which is too hot).

> 5 s is the sweet spot identified in brainstorming: a running player
> moves ~40–75 tiles in 5 s, easy to interpolate smoothly on the
> client; 1–2 s feels like surveillance and 10 s+ feels laggy on
> a dashboard you have open.

### 5.2 Ingest storage — cache + selective persistence

Not everything belongs in the DB:

| Data | Storage | Retention | Why |
|------|---------|-----------|-----|
| Latest position per player | **In-memory map**, `Map<username, PositionSnapshot>` | Until next update or 120 s stale | Positions at 5 s cadence would be ~17 k rows/day for 1 player; pointless to persist |
| Heartbeat (TPS, uptime, etc.) | **In-memory**, last value only | Overwritten | Dashboard reads current, history isn't Phase 4 |
| `death` events | **Postgres**, new `WorldEvent` row | 90 days default | Useful for death markers, analytics, Discord embeds |
| `join`/`leave` events | **Postgres**, same `WorldEvent` table | 90 days | Timeline + audit + playtime aggregates |
| `chat` events | **Postgres**, gated by `INGEST_STORE_CHAT` env (default `false`) | 30 days if enabled | Privacy-sensitive, opt-in |
| `helicopter` events | **Postgres** | 90 days | Rare, useful for map pins |

In-memory store lives on the Next.js server process. Single-process
today; when WS/SSE scales out we swap the `Map` for Redis (out of
scope for Phase 4).

### 5.3 Frontend transport — SSE, not WS

The master spec chose WS because RCON terminal needs bidirectional
streaming. Player-position data is **one-way server → client**. Use
**Server-Sent Events** for `players:positions`:

- Next.js 15 supports SSE natively via `ReadableStream`.
- Auto-reconnect with `Last-Event-ID` is built into the browser.
- No custom WS framing / auth handshake for a read-only stream.
- Survives HTTP/2 and most corporate proxies better than WS.

The `/api/ws` WebSocket server (already deployed for RCON output)
remains, but `players:positions` moves to
`GET /api/stream/positions` (SSE).

This is a small deviation from master spec §6 — flagged in §13 of
this doc as a decision to reconfirm.

### 5.4 Public anonymization policy

Public map (`/`) shows **different data** than the admin map (`/admin/map`):

| Aspect | Admin view | Public view |
|--------|-----------|-------------|
| Player name | Exact | Hidden (show role badge only, or just "Survivor") |
| Coordinates | Exact | Snapped to **250 tile grid** (~250m in-world) |
| Refresh cadence | 5 s | 30 s |
| Health / hunger / thirst | Shown | Hidden |
| Death markers | 90 days, exact location | 7 days, snapped to 500 tile grid |
| Region label ("West Point") | Shown | Shown |
| Player count per region | Shown | Shown |

Rationale: this protects active players from being stalked IRL by
anyone watching the public map, while keeping the "look, there are 3
people in Muldraugh right now" community feel.

### 5.5 Degraded modes

Three independent failure axes. Each needs explicit UX.

| Failure | Detection | Frontend treatment |
|---------|-----------|---------------------|
| PZ server offline | RCON connection fails | Map renders, last-known positions ghosted at 50% opacity, banner "Server offline since HH:MM" |
| PZ online but Lua mod stopped posting | No webhook POST for > 2× tick (10 s) | Positions marked `stale: true`, yellow dot, tooltip "Last seen N s ago" |
| pz-crcon offline | SSE stream closes | Browser auto-reconnects (EventSource default); UI shows reconnecting spinner for > 5 s |
| Tile server 404s | Already handled in `knox-map.tsx` | Falls back to TIS tiles, then to empty canvas with marker layer |

### 5.6 Lua mod skeleton

`lua-mod/` directory structure (already stubbed in master spec §4):

```
lua-mod/
├── mod.info                    # id=PZCrcon, name, versionMin=41.78
├── poster.png                  # Workshop thumbnail
└── media/lua/server/PZCrcon/
    ├── Config.lua              # reads Zomboid/Server/PZCrcon.cfg
    ├── Hmac.lua                # HMAC-SHA256 (pure-Lua or via bit32)
    ├── Http.lua                # non-blocking POST via LuaManager
    ├── Queue.lua               # ring buffer, max 50 events
    ├── Tick.lua                # Events.OnTick gate (5 s interval)
    └── Events.lua              # OnPlayerDeath, OnPlayerConnect, OnChatMessage, OnHelicopter
```

One file per concern, each ≤ 150 lines. Matches the "smaller well-bounded
units" principle from the master spec.

### 5.7 Discord notifications

Part of Phase 4 per master spec. Concrete defaults:

| Event | Default | Channel hint | Notes |
|-------|---------|--------------|-------|
| Player join | enabled | `#server-log` | Just the username |
| Player leave | disabled | — | Noisy |
| Death | enabled | `#graveyard` | Username + cause + region; optional coords for admins only |
| Helicopter | enabled | `#events` | Targeted player + time |
| Chat | disabled | — | Spam risk |
| Panel offline / mod stale | enabled | `#ops` | Throttled to 1/hour |

Configurable in the Settings page (Phase 3 dependency) — stored in
`Settings` table, keyed by `notification.<event>.enabled`.

## 6. Scope matrix — Phase 4 vs. later

**Ship in Phase 4:**

- Lua mod v1: tick timer, HMAC, HTTP POST, `join`/`leave`/`death`/`chat`/`helicopter`/`pos`/heartbeat.
- Workshop publish with Steam page linking to the pz-crcon README.
- `POST /api/webhook/mod` with HMAC verify + nonce replay LRU.
- In-memory position map + `WorldEvent` table for persisted events.
- `GET /api/stream/positions` (SSE) — admin and public variants.
- Admin map: live dots with names, health tooltip, 5 s refresh.
- Public map: fuzzy dots, 30 s refresh, anonymized.
- Death markers on admin map (90 days), public map (7 days, fuzzy).
- Discord notifications: `join` / `death` / `helicopter` / mod-stale.
- Stale / offline UX on the map.

**Defer to Phase 5+:**

- **Path trails** — keep last N positions per player, render as
  translucent polyline. Fun but needs UI polish and replay-buffer
  lifecycle.
- **24h heatmap overlay** — aggregate positions over time; separate
  background-job pipeline to roll up minute-bucket → hour-bucket →
  heatmap tiles.
- **POI triggers** — region-entry events ("Kashek entered West Point PD").
  Needs a region polygon dataset we don't have yet.
- **24h replay animation** — time-slider scrubber over historic
  positions. Requires persisting positions (opposite of §5.2 decision).
- **Per-player stats tooltip** (HP, hunger, thirst, mood) — needs Lua
  mod v2 with extra payload. Admin-only for privacy.
- **Mobile push / "in danger"** — nice meme, but a web panel is not a
  good transport; punt to a separate Discord slash command.

## 7. API surface additions (delta from master spec)

| Method | Path | Auth | Purpose | Status |
|--------|------|------|---------|--------|
| POST | `/api/webhook/mod` | HMAC | Ingest events from Lua mod | master spec |
| GET | `/api/stream/positions` | public (query `?mode=public`) or session (admin) | SSE stream of positions + events | **new in this doc** |
| GET | `/api/events` | viewer+ | Paginated `WorldEvent` history (for timeline view) | **new** |
| GET | `/api/deaths` | public (fuzzed) / viewer+ (exact) | Death markers for map overlay | **new** |

`GET /api/players/positions` (already exists) remains as a **fallback
polling endpoint** for clients that can't open SSE. Internally reads
from the same in-memory position map.

## 8. Data models (delta)

New Prisma model:

```prisma
model WorldEvent {
  id        String   @id @default(cuid())
  kind      String   // "join" | "leave" | "death" | "chat" | "helicopter"
  player    String?  // null for server-scope events
  region    String?
  x         Int?
  y         Int?
  z         Int?
  day       Int?
  metaJson  Json?    // cause of death, chat text (if enabled), target, etc.
  ts        DateTime @default(now())

  @@index([kind, ts])
  @@index([player, ts])
}
```

Retention is a nightly cron job: `WorldEvent` rows older than N days
(per-kind TTL from §5.2) are deleted. Simple `DELETE WHERE ts < ...`.

In-memory types (`lib/positions/cache.ts`, not persisted):

```ts
type PositionSnapshot = {
  username: string;
  x: number;
  y: number;
  z: number;
  region: string | null;
  health: number | null;   // 0..1
  day: number | null;
  receivedAt: number;      // Date.now() at ingest
};

type Heartbeat = {
  uptimeSec: number;
  tps: number;
  playersOnline: number;
  day: number | null;
  receivedAt: number;
};
```

## 9. Error handling and degraded states

### Ingest endpoint

- Reject `> 60 s` timestamp skew → 401.
- Reject replayed nonce → 401.
- Reject invalid HMAC → 401 (timing-safe compare).
- Reject payload `> 256 KB` → 413.
- Reject payload with > 100 events → 413 (mod config caps at 50, 2× margin).
- Per-source rate limit: max 20 req/s per IP → 429 (a well-behaved mod
  sends ~0.2 req/s at 5 s tick).
- On unexpected error, log and return 500; Lua mod treats 5xx as
  retry-later (drop-oldest queue, no infinite retry loop).

### Lua mod

- If HTTP POST returns non-2xx, increment local retry counter.
- Exponential backoff: 5 s → 10 s → 30 s → 60 s, cap at 60 s.
- While backing off, keep buffering to the ring queue; drop oldest
  when full. Heartbeat + deaths + joins are prioritized; `pos` events
  are the first to be dropped (they're replaceable — only the latest
  matters).
- Panel totally dead for > 10 minutes: reduce tick to 60 s heartbeat-only,
  re-accelerate on first successful POST.

### Frontend

- SSE reconnect with backoff (native EventSource already does this).
- `stale` flag in the snapshot drives UI state; we never render a stale
  snapshot as if fresh.
- "Server offline" banner is the highest-severity toast; takes over
  the map header.

## 10. Security additions (beyond master spec)

- **HMAC secret rotation:** a new `PZCRCON_SECRET_NEXT` env var can
  run alongside the primary `PZCRCON_SECRET` during rotation; both
  are accepted for verify, only the primary is used for outgoing
  sign. Rotation procedure documented in the runbook.
- **Public stream abuse:** the public SSE is anonymous and rate-limits
  per IP (20 concurrent connections per /24); beyond that, 429. Mitigates
  scraping the public feed into a competing tracker.
- **Panel → PZ data boundary:** the ingest endpoint never executes
  anything based on Lua-supplied data. Strings are treated as
  opaque. JSON parsing uses a Zod schema with a strict allow-list
  of `kind` values; unknown kinds are dropped with a warning log.
- **Lua mod hash pinning:** release artifacts (Workshop zip +
  checksum) published on GitHub Releases; docs tell operators to
  verify before installing. Prevents Workshop tampering surprises.

## 11. Risks added on top of master spec §13

| Topic | Risk | Mitigation |
|-------|------|------------|
| B41 vs B42 Lua API drift | `OnTick`, `getOnlinePlayers`, `player:getX/Y/Z` need to exist on both; Indie Stone renamed things before | One `Api.lua` shim, feature-detects on load, fails soft with server-log warning if missing |
| Public tile server churn | `pzmap.crash-override.net` could go down or rate-limit us when the public map goes viral | Already handled in `knox-map.tsx` with TIS fallback; longer-term self-host via `pzmap2dzi` (Phase 2 backlog) |
| Public map abuse for griefing | Real-time public tracking could let trolls find players IRL or coordinate PVP ambushes | §5.4 anonymization + 30 s cadence + 250-tile snap |
| Mod stops without noticing | Silent failure — panel shows old positions forever | §5.5 stale detection + Discord `#ops` notification |
| Lua HTTP blocking the game thread | Synchronous `LuaNet` calls can stall the server tick | Use non-blocking `HTTPClient` (B42) or worker thread pattern (B41); documented in `Http.lua` |
| Timezone confusion in day counter | PZ in-game "day" is not real-world day; admins get confused | Always render with "Day N / YYYY-MM-DD HH:MM server" prefix |

## 12. Testing plan

| Layer | What | Tool |
|-------|------|------|
| Unit | HMAC verify (happy, expired, bad nonce, timing) | Vitest |
| Unit | Zod payload parser (all event kinds, unknown kind rejected) | Vitest |
| Unit | Position cache (insert, TTL eviction, concurrent reads) | Vitest |
| Unit | Death retention cron (90 days admin / 7 days public fuzzing) | Vitest |
| Unit | Public coord fuzzer (snap to 250-tile grid is stable) | Vitest |
| Integration | `POST /api/webhook/mod` with real Postgres, verifies `WorldEvent` row shape | Vitest + Prisma test DB |
| Integration | `GET /api/stream/positions` streams SSE frames, emits on ingest | Vitest with synthetic ingest |
| E2E | Full loop: synthetic Lua payload → SSE → Leaflet marker updates | Playwright + mock mod script |
| Manual | Install mod on staging PZ server, observe 30 min of traffic | Local / HomePL |

Lua side is harder to unit-test. Option: run mod under `luajit` in CI
with a stub `getOnlinePlayers()` → JSON file fixture → assert the
emitted POST body. Nice-to-have, not gating.

## 13. Decisions to reconfirm with the human

- **D1.** Use SSE for `players:positions` instead of the WS channel
  the master spec committed to. Deviation is small but public.
- **D2.** Default tick rate is **5 s** (not the 10 s `heartbeat_seconds`
  in the master spec's example config — those are separate now).
- **D3.** Chat events are **not stored by default**. Opt-in via
  `INGEST_STORE_CHAT=true` env. Master spec §7 shows chat in the
  payload; it still flows through in-memory for Discord bridging,
  just doesn't hit the DB.
- **D4.** Public map shows **"Survivor"** + fuzzy position, not the
  player name. If the community asks for opt-in "show my name", we
  add that in Phase 5.
- **D5.** Trails, heatmap, replay, POI triggers, stats tooltip,
  mobile push — **all deferred to Phase 5**. Phase 4 is tight.

If any of these is wrong, this doc gets revised before the Phase 4
implementation plan is written.

## 14. Dependencies and ordering

Phase 4 ideally runs **after** Phase 3 (Settings page), because
Discord notification configuration lives in Settings. It is, however,
possible to land Phase 4 without a Settings UI by reading defaults
from env vars and hard-coding the Discord webhook URL — this is the
"skip Phase 3" path if the user wants the map live sooner.

Hard dependencies:

- A Discord webhook URL (or bot token) configured in env.
- An HMAC secret provisioned and written into the PZ server's
  `Zomboid/Server/PZCrcon.cfg`.
- Node 22 on the pz-crcon container (already the case).

Soft dependencies (nice to have before Phase 4 lands):

- Phase 3 Settings page for Discord + notification toggles.
- Self-hosted Knox tiles (Phase 2 backlog) — not required, but
  insulates the public map from community-server churn.

## 15. Next steps

1. Human reviews this brainstorm doc (§13 decisions in particular).
2. Merge accepted decisions into the master spec or keep this doc
   as the authoritative Phase 4 annex (operator's call).
3. Invoke `writing-plans` on top of this doc to produce
   `docs/superpowers/plans/2026-04-20-phase4-live-map.md` with the
   actual checklist of implementation chunks.
4. Phase 4 implementation follows the usual pattern:
   `chunk1-lua-scaffold`, `chunk2-webhook-ingest`, `chunk3-cache-sse`,
   `chunk4-admin-map`, `chunk5-public-map`, `chunk6-discord-notifs`.
   Each as a separate PR, each mergeable independently.

---

## Appendix A — Why not just polling?

Master spec §14 already decided push over poll. For completeness:
polling `getOnlinePlayers()` via RCON would need exact coords, and
the RCON `players` command only returns names. Any polling path ends
up requiring a server-side mod to expose coords — at which point
push is strictly better (fewer round trips, lower latency, no
wake-server-to-ask overhead).

## Appendix B — Why 5 s and not faster?

- PZ network tick is 20 Hz; player position updates are batched
  from the server anyway.
- A running survivor covers ~40 tiles in 5 s; Leaflet's marker
  transition can interpolate smoothly over that.
- 1 s ticks = 5× the HTTP overhead, 5× the HMAC CPU cost, 5× the
  JSON parse work. For a dashboard that sits on someone's second
  monitor for hours, this matters.
- If someone really wants a 1 s "combat cam" later, we add an
  admin-only `?fast=true` query param and bump the Lua mod tick
  on demand — out of scope here.

## Appendix C — Why SSE over WS for this channel?

- One-way, server-initiated, text-framed: SSE is literally the
  HTTP-level primitive for this case.
- Browser auto-reconnect with `Last-Event-ID` is free.
- Works through HTTP/2 and proxies that mangle WS upgrades.
- Doesn't compete with `/api/ws` for process-local WS capacity
  (RCON terminal is the heavy WS consumer).
- We keep the WS server; `players:positions` just isn't on it.
