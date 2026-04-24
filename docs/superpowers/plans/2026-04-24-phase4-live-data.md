# PZ-CRCON Phase 4 — Live Data: Lua mod, Webhook, Live Map

> **For agentic workers:** Use the `superpowers:subagent-driven-development`
> skill. Mark tasks with `- [ ]` / `- [x]`.

**Goal:** Ship the **companion PZ Lua mod** and the panel-side ingest so the
public live map stops faking coordinates, the admin panel sees real deaths
and events, and Discord notifications trigger on real game signals. Ship
as **v0.5.0 — feature complete**.

**Architecture:**

```
pz-server (Lua mod)
   └── every N seconds: POST /api/webhook/mod
            ↳ HMAC-SHA256 body, batched {positions, events}
                 ↓
   ┌──────────────────────────────────────────┐
   │  pz-crcon API                            │
   │                                          │
   │  POST /api/webhook/mod ──► HmacVerifier  │
   │         ↓                                │
   │  ┌───────────────┐     ┌──────────────┐  │
   │  │ LivePositions │     │ WorldEvent   │  │
   │  │ in-memory map │     │ Prisma model │  │
   │  └───────┬───────┘     └──────┬───────┘  │
   │          │                    │          │
   │          │                    ▼          │
   │          │            Dispatcher ──►     │
   │          │            events:admin WS    │
   │          │            Discord notifier   │
   │          │                               │
   │          ▼                               │
   │  GET /api/stream/positions (SSE)         │
   │       (anonymised for public,            │
   │        precise for VIEWER+)              │
   └──────────────────────────────────────────┘
            ↓
   public map / admin map
```

**Decision memo (to be captured as ADR-0004):** SSE is chosen over WS for
positions because (a) strictly one-way, (b) survives most CDNs without
sticky config, (c) Cloudflare handles EventStream cleanly. Admin events
still go over the existing `events:admin` WS because they are bidirectional
(admin subscribes, panel publishes, admin may ack in the future).

**Tech Stack:** existing plus **node:crypto** (`createHmac`) — no new npm
deps. Lua mod code lives in `mods/pz-crcon/` and uses only PZ's built-in
Lua API.

**Reference:**

- `docs/superpowers/plans/2026-04-24-gap-analysis.md` §4
- `docs/superpowers/specs/2026-04-20-phase4-live-map-design.md`

**Repo state at plan start:** branch `phase4-live-data` off `main` with
Phase 3 merged.

---

## File Structure (target after Phase 4)

```
pz-crcon/
├── mods/pz-crcon/                           # Companion Lua mod
│   ├── mod.info                             # C4
│   ├── poster.png
│   └── media/lua/server/
│       ├── PZCrcon.lua                      # C4 — main loop
│       ├── PZCrcon_Config.lua               # C4 — defaults
│       ├── PZCrcon_Events.lua               # C4 — hooks
│       └── PZCrcon_Hmac.lua                 # C4 — SHA256 impl
├── lib/
│   ├── ingest/
│   │   ├── hmac.ts                          # C1 — verify + rotation
│   │   ├── positions-store.ts               # C2 — in-memory + tick
│   │   └── events-store.ts                  # C2 — fan-out + persist
│   ├── events/
│   │   ├── types.ts                         # C2 — union of WorldEvent kinds
│   │   └── anonymiser.ts                    # C3 — public grid + redaction
│   └── stream/
│       └── sse.ts                           # C3 — SSE writer helpers
├── prisma/schema.prisma                     # C1 — WorldEvent model, drop PlayerEvent? keep for now
├── app/api/
│   ├── webhook/mod/route.ts                 # C1 — POST ingest
│   ├── stream/positions/route.ts            # C3 — GET SSE
│   ├── events/route.ts                      # C2 — GET list
│   └── deaths/route.ts                      # C2 — GET list + since cursor
├── components/
│   └── map/
│       ├── event-overlay.tsx                # C3 — deaths, heli, generators
│       └── trails.tsx                       # C5 (deferred)
└── tests/
    ├── unit/
    │   ├── ingest-hmac.test.ts
    │   ├── positions-store.test.ts
    │   ├── events-anonymiser.test.ts
    │   └── sse-writer.test.ts
    ├── integration/
    │   ├── api.webhook-mod.test.ts
    │   ├── api.stream-positions.test.ts
    │   ├── api.events.test.ts
    │   └── api.deaths.test.ts
    └── fixtures/
        └── mod-payloads.json
```

---

## Chunk 1 — Webhook ingest foundation

**Payload contract (v1).** Sent as JSON body of `POST /api/webhook/mod`.

```jsonc
{
  "schema": 1,
  "serverId": "majorlukpz",                   // opaque, matches env
  "sentAt": 1716201234567,                    // ms, for drift check
  "positions": [
    {
      "steamId": "7656119...",
      "name": "SurvivorBob",
      "x": 10732.5, "y": 8721.1, "z": 0.0,
      "health": 0.97, "hunger": 0.23, "thirst": 0.18, "fatigue": 0.33,
      "inGameDay": 12, "inGameHourMin": 1438,
      "region": "Muldraugh",
      "perks": { "Fitness": 6, "Strength": 5, "Cooking": 3 }
    }
  ],
  "events": [
    {
      "kind": "death",
      "ts": 1716201200000,
      "steamId": "7656119...",
      "name": "SurvivorBob",
      "x": 10732.5, "y": 8721.1,
      "cause": "zombie",
      "nearby": ["SurvivorAlice"]
    }
    // kinds: death, join, leave, heli_event, gunshot, generator, mod_stale, chat
  ]
}
```

Headers:

- `X-Pz-Signature: sha256=<hex>` (HMAC-SHA256 over the raw body using
  `WEBHOOK_HMAC_SECRET`)
- `X-Pz-Secret-Rev: current | next` (so rotation can accept either for a
  window)

Tasks:

- [ ] `prisma/schema.prisma`: add `WorldEvent { id, kind String, payload Json, occurredAt DateTime, serverId String, @@index([kind, occurredAt]) @@index([serverId, occurredAt]) }`. Migration.
- [ ] `lib/env.ts`: accept `WEBHOOK_HMAC_SECRET_NEXT` (optional, enables rotation window), `INGEST_MAX_BODY_KB` (default 512), `INGEST_STORE_CHAT` (default `false` — GDPR).
- [ ] `lib/ingest/hmac.ts`: `verify(body: Buffer, signatureHeader: string, rev: "current" | "next"): boolean`. Constant-time compare.
- [ ] `app/api/webhook/mod/route.ts` (POST): no session, reads raw body, verifies HMAC, validates with Zod, splits into `positions-store` + `events-store`. Rate-limit: 20 req / 10 s per IP; 413 on oversize.
- [ ] Integration test — happy, wrong HMAC (403), malformed (400), oversize (413).
- [ ] Unit test — HMAC rotation window accepts both revs.

---

## Chunk 2 — Stores, events, REST

- [ ] `lib/ingest/positions-store.ts`: in-memory `Map<steamId, Position>` plus `lastUpdated`. Prune entries stale > 120 s. Expose `all()`, `public()` (anonymised via §3), `byId()`.
- [ ] `lib/ingest/events-store.ts`: for each event kind, either push to DB (`WorldEvent`) or skip (chat off by default). **Every** event also `publish("events:admin", ...)` so Discord notifier and admin map light up.
- [ ] `/api/events` (VIEWER+) — `GET`, query `kind`, `from`, `to`, `cursor`, `limit`. Cursor pagination on `occurredAt, id`.
- [ ] `/api/deaths` (public anonymised / VIEWER+ full) — reuses events-store with `kind = 'death'`; public drops `name` and snaps coords to 250-unit grid.
- [ ] Update `/api/players/positions` to **delegate** to `positions-store.public()` when data is fresh; fall back to the current placeholder only when the store is cold. Returns an `approximate: boolean` field so the client knows what it got.
- [ ] Update `/api/status` to include `inGameDay`, `inGameHourMin`, `weather?` (if any position has it) — closes the README "weather / in-game time" promise.
- [ ] Unit tests: store eviction, public-vs-full projection, event-kind fan-out.
- [ ] Integration tests for `/api/events`, `/api/deaths`.

---

## Chunk 3 — SSE positions + map overlay

- [ ] `lib/stream/sse.ts`: `createSseStream(req, { heartbeatMs: 15_000 })` returning a `ReadableStream` + a typed `publisher`. Uses web-standard `Response` with `Content-Type: text/event-stream`.
- [ ] `app/api/stream/positions/route.ts` (GET): opens SSE, immediately sends a `positions` event with the latest snapshot, then publishes on every mutation of `positions-store`. For public (no session) uses anonymised snapshot with 30 s tick; for authed VIEWER+ uses 2 s tick.
- [ ] `lib/events/anonymiser.ts`: grid-snap to 250 units, drop Steam IDs, hash names into a short opaque token (survives across ticks for the same player within a session, resets hourly).
- [ ] `components/map/knox-map.tsx`: switch from polling `/api/players/positions` to SSE stream; keep REST as fallback if EventSource errors.
- [ ] `components/map/event-overlay.tsx`: renders death skulls for the last N deaths pulled from `/api/deaths?since=`. Expire after 60 minutes.
- [ ] Rate-limit per IP on the public SSE (20 concurrent connections max per /24) — use a tiny in-memory counter on the server.
- [ ] Integration test `api.stream-positions.test.ts`: connect, assert first snapshot arrives, push ingest, assert update arrives, close cleanly.

---

## Chunk 4 — Companion Lua mod

Lua mod code lives under `mods/pz-crcon/` in-repo. A release workflow can
optionally push it to Steam Workshop; for now we ship a `scripts/
package-mod.sh` that produces a zip for manual install and a release asset.

- [ ] `mods/pz-crcon/mod.info`: name, id, description, `require=`, `versionMin=41.78`, `poster=poster.png`.
- [ ] `media/lua/server/PZCrcon_Config.lua`: defaults — `endpoint="http://pz-crcon:3000/api/webhook/mod"`, `token="<paste>"`, `heartbeatSec=3`, `eventBatchSize=50`, `includeInvisible=false`.
- [ ] `media/lua/server/PZCrcon_Events.lua`: hooks for `Events.OnPlayerDeath`, `OnTick` (coalesced), `OnConnected`, `OnDisconnected`, `OnHelicopter`, `OnPlayerUpdate`.
- [ ] `media/lua/server/PZCrcon_Hmac.lua`: SHA-256 implementation in pure Lua (use or port a known MIT-licensed implementation; include its licence header). Sign the JSON body, produce hex.
- [ ] `media/lua/server/PZCrcon.lua`: main loop owned by the server. Batches positions + events, emits JSON (PZ's `jzlib`-free JSON writer — include one if needed), `luanet.urlRequest` or the standard `getURL` to POST. Deduplicates by session.
- [ ] Config file on the PZ server host: `/opt/docker/projectzomboid/pz-data/Server/PZCrcon.cfg` — shipped empty, operator fills in endpoint + token.
- [ ] `docs/lua-mod-protocol.md`: canonical payload schema (v1), HMAC algorithm, rotation procedure.
- [ ] `docs/lua-mod-install.md`: install from Workshop, paste token, verify with `/api/webhook/mod/ping`.
- [ ] GitHub Actions: release workflow optionally publishes `mods/pz-crcon` as a release asset on tag push.
- [ ] Smoke test: `pnpm tsx scripts/mod-smoke.ts` sends a known payload with a known secret to `localhost:3000` and asserts 200.

**Lua dev tactics:** every lua module wraps its top-level logic in
`pcall(...)`; any crash is caught and logged via `print(...)` so it shows up
in the panel's log tail.

---

## Chunk 5 — Discord notifications hook-up

(Relies on `phase3-settings`.)

- [ ] `lib/notifications/dispatcher.ts` already subscribes to `events:admin`. Add event-kind mapping from `WorldEvent.kind` to human embeds: death ("SurvivorBob was eaten by zombies in Muldraugh"), heli ("Helicopter event just started"), mod_stale ("Workshop mod XYZ has a new version"), backup_failed (already wired in Phase 3).
- [ ] Add a "last 10 deaths" admin card on `/admin`.
- [ ] **ADR-0004** — SSE vs WS for positions — land the decision doc.
- [ ] **ADR-0005** — Lua mod HMAC scheme and rotation — land the decision doc.

---

## Acceptance criteria

- [ ] With the Lua mod installed on the PZ server, the public map shows real player dots (anonymised, grid-snapped) within 60 seconds of a player joining; admin map shows precise dots updated every 2 seconds.
- [ ] Death events appear in `/admin/logs` (Phase 2 log viewer) **and** on the map overlay within 5 seconds, and a Discord webhook fires (Phase 3 toggle).
- [ ] HMAC rotation: setting both `WEBHOOK_HMAC_SECRET` and `WEBHOOK_HMAC_SECRET_NEXT` lets requests signed with either header succeed; removing `_NEXT` cleanly rejects the old.
- [ ] `/api/status` includes accurate `inGameDay` and `inGameHourMin` pulled from the latest payload.
- [ ] Public SSE endpoint survives one hour of an EventSource client with no memory leak (manual verification with `node --expose-gc` + local k6).
- [ ] `INGEST_STORE_CHAT=false` actually drops chat events from the DB while still fanning to admin WS (so Discord chat-bridge could consume them without persisting).
- [ ] `mod-smoke.ts` exits 0 locally.

---

## Cut line (explicit Phase 5+, do **not** plan here)

- Player trails (last 5 minutes path) — design doc calls this out.
- Heatmap layer of death density.
- POI editor (admin drops markers).
- Replay mode (scrubber through last 24 h of events).
- Mobile push notifications for admins on critical events.
- Dedicated fast-tick admin WS channel (500 ms) — current SSE is enough.
