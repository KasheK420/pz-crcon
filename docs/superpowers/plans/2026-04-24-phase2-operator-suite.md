# PZ-CRCON Phase 2 — Operator Suite

> **For agentic workers:** Use the `superpowers:subagent-driven-development`
> skill (or `superpowers:executing-plans`) to implement this plan. Every task
> uses `- [ ]` so progress can be tracked in place.

**Goal:** Close the remaining admin-panel gaps a real operator needs day to
day **before** we build the Lua mod: a working Mod Manager, a persistent Log
Viewer, and a Player Profile page. Ship as **v0.3.0**.

**Architecture:** Three independent feature groups:

1. **Mod Manager** — reads `servertest.ini`'s `Mods=` + `WorkshopItems=`
   lists, overlays Workshop metadata (already in `Mod` table), lets OWNER
   toggle / reorder / add. Saves via the Phase 1.7 INI writer to keep the
   atomic/backup behaviour.
2. **Persistent Logs** — background ingester tailing `docker logs pz-server`
   (already streamed for `logs:server` WS) plus the PZ console log files in
   `pz-data/Logs/`, parses lines into typed categories (server / chat /
   death / perk / admin), persists in a new `ServerLog` table with
   rolling retention, exposes `/admin/logs` tabs with filter + search +
   export.
3. **Player Profile** — dedicated page at `/admin/players/[id]` with notes
   editor, ban duration + reason form, recent action history, and a
   playtime estimator driven by session diffs of the RCON `players`
   roll-call (good enough until the Lua mod ships accurate heartbeats).

**Tech Stack:** existing (Next 15 / Prisma 5 / Zod / shadcn/ui / pino /
async-mutex). No new top-level deps expected except maybe `nanoid` for log
ids (`crypto.randomUUID()` is fine and ships out of the box).

**Reference:** `docs/superpowers/plans/2026-04-24-gap-analysis.md` §2.

**Repo state at plan start:** branch `phase2-operator-suite` off `main`
(Phase 1.7 merged). Seed data in `lib/db/seed.ts` will need a small extension
for logs tests.

---

## File Structure (target after Phase 2)

```
pz-crcon/
├── prisma/schema.prisma                     # C1 — +ServerLog, +PlayerNote;
│                                            # drop SandboxOverride, ServerEvent
├── lib/
│   ├── env.ts                               # C0 — extend with all PZ_* /
│   │                                        # PUBLIC_* / DOCKER_* used in app
│   ├── logs/
│   │   ├── categories.ts                    # C2 — regex → category
│   │   ├── ingester.ts                      # C2 — tails docker + FS logs
│   │   ├── store.ts                         # C2 — prisma writer, retention
│   │   └── types.ts                         # C2
│   ├── pz/
│   │   ├── mods-parser.ts                   # C1 — extract ini Mods=/Workshop=
│   │   └── mods-writer.ts                   # C1 — build new ini patch
│   └── players/
│       ├── playtime.ts                      # C3 — RCON-diff playtime
│       └── session-tracker.ts               # C3 — in-memory session state
├── app/
│   ├── (admin)/admin/
│   │   ├── mods/page.tsx                    # C1
│   │   ├── logs/page.tsx                    # C2 — tabs + history
│   │   └── players/
│   │       └── [id]/page.tsx                # C3
│   └── api/
│       ├── mods/
│       │   ├── route.ts                     # C1 — GET list, POST add
│       │   └── [workshopId]/route.ts        # C1 — PATCH toggle/reorder, DELETE
│       ├── logs/
│       │   ├── route.ts                     # C2 — GET history + filter
│       │   └── export/route.ts              # C2 — CSV / JSONL download
│       └── players/
│           ├── [playerId]/route.ts          # C3 — GET profile
│           └── [playerId]/notes/route.ts    # C3 — POST/DELETE notes
├── components/
│   ├── mods/
│   │   ├── mods-table.tsx                   # C1
│   │   ├── add-mod-dialog.tsx               # C1
│   │   └── reorder-controls.tsx             # C1
│   ├── logs/
│   │   ├── logs-history-view.tsx            # C2
│   │   ├── log-filter-bar.tsx               # C2
│   │   └── log-row.tsx                      # C2
│   └── players/
│       ├── player-profile-header.tsx        # C3
│       ├── player-notes.tsx                 # C3
│       ├── player-ban-dialog.tsx            # C3 — duration + reason
│       └── player-history.tsx               # C3
└── tests/
    ├── unit/
    │   ├── pz-mods-parser.test.ts
    │   ├── logs-categories.test.ts
    │   └── playtime.test.ts
    └── integration/
        ├── api.mods.test.ts
        ├── api.logs.test.ts
        └── api.players-profile.test.ts
```

---

## Chunk 0 — Env & schema cleanup (prereq)

- [ ] Extend `lib/env.ts` with `optionalPzEnv()` (or inline fields) covering every env var that code already reads via `process.env`: `PZ_CONTAINER_NAME`, `PZ_SERVER_CONTAINER`, `PZ_CRCON_CONTAINER`, `PZ_CONFIG_DIR`, `PZ_SERVER_DIR`, `PZ_BACKUP_DIR`, `PZ_DATA_DIR`, `PZ_SERVER_PREFIX`, `PZ_TILES_DIR`, `DOCKER_SOCKET_PATH`, `DOCKER_CONTROL_URL`, `PUBLIC_SERVER_NAME`, `PUBLIC_SERVER_ADDRESS`, `PUBLIC_DISCORD_URL`, `PUBLIC_MAX_PLAYERS`, `NEXT_PUBLIC_PZ_TILE_URL`, `NEXT_PUBLIC_PZ_MIN_X/Y/MAX_X/Y`, `PORT`, `MOD_WORKSHOP_IDS`.
- [ ] Add unit test in `tests/unit/env.test.ts` covering optional fields defaulting correctly.
- [ ] Drop `SandboxOverride` and `ServerEvent` from `prisma/schema.prisma` (Prisma migration). Add a `CHANGELOG` note "BREAKING (schema): dropped two unused tables".
- [ ] Update `CHANGELOG.md` [Unreleased] to mention Phase 1.7 retroactively **and** the dropped tables.
- [ ] `pnpm db:validate && pnpm typecheck && pnpm test` green.

---

## Chunk 1 — Mod Manager

**Data source:** The authoritative list of enabled mods is
`Mods=<mod-id1>;<mod-id2>;...` and `WorkshopItems=<wid1>;<wid2>;...` in
`servertest.ini`. Disabled-but-installed mods live in the upstream Workshop
metadata (already in `Mod` table). We edit the INI via the Phase 1.7 writer
so we inherit atomic writes + `.bak-<iso>` + CSRF.

- [ ] `lib/pz/mods-parser.ts`: `parseModsLine(raw: string): string[]` and `serializeModsLine(ids: string[]): string` with tests.
- [ ] `lib/pz/mods-writer.ts`: `patchIniModsAndWorkshop(patch: { modIds: string[]; workshopIds: string[] })` returning a writer-compatible INI patch for `Mods` and `WorkshopItems`.
- [ ] `GET /api/mods` → `{ enabled: Mod[], available: Mod[] }` — merges ini-enabled ids with `Mod` rows, marks `enabled` in result.
- [ ] `POST /api/mods` (OWNER, CSRF) — body `{ workshopId: string, modId: string }` → upserts `Mod` row, appends to both ini lists, calls writer.
- [ ] `PATCH /api/mods/:workshopId` (OWNER, CSRF) — body `{ enabled?: boolean, loadOrder?: number }` → toggles presence in ini lists or reorders.
- [ ] `DELETE /api/mods/:workshopId` (OWNER, CSRF) — removes from both ini lists; row stays in `Mod` table (soft-uninstall).
- [ ] `components/mods/mods-table.tsx`: shadcn `Table` with thumb / name / workshop link / version / enabled toggle / drag-handle / delete button.
- [ ] `components/mods/add-mod-dialog.tsx`: paste Workshop URL → extract id → fetch Steam meta (reuse `scripts/sync-mods.ts` logic in a lib helper `lib/mods/steam.ts`).
- [ ] `app/(admin)/admin/mods/page.tsx`: SSR-loads `GET /api/mods`, mounts client table. OWNER only (return 403 banner otherwise like `/admin/startup`).
- [ ] Sidebar entry under `components/shell/nav-config.ts` (OWNER+).
- [ ] Restart prompt after save: reuse `RestartPromptModal` already wired on config page.
- [ ] Integration test `tests/integration/api.mods.test.ts` — happy path + wrong-role 403 + CSRF reject.

**Non-goal:** conflict detection and dependency graph. Those land in Phase
2.5 once we can read the mod's own `mod.info` metadata from disk.

---

## Chunk 2 — Persistent Logs + Full Viewer

**Ingestion model:** Two sources, both feeding `lib/logs/store.ts`:

1. **Docker logs** — extend the existing `lib/ws/log-streamer.ts` to split
   into (a) WS pass-through (current behaviour) and (b) ingester pipe.
2. **PZ console log files** under `/server/Logs/<prefix>_<date>/` (server,
   chat, PerkLog, DebugLog, etc.) — read incrementally per file with an
   offset file per log kind in `/server/.pz-crcon-state/`.

- [ ] `prisma/schema.prisma`: new model `ServerLog { id cuid, kind String, level String?, source String, ts DateTime, message String, meta Json? @@index([kind, ts]) }` plus retention index `@@index([ts])`. Migration + `db:generate`.
- [ ] `lib/logs/types.ts`: `LogKind = 'server' | 'chat' | 'death' | 'perk' | 'admin' | 'unknown'` and `LogLevel`.
- [ ] `lib/logs/categories.ts`: regexes to classify a line into `{ kind, level, source, message, meta }`. Hand-rolled rules plus tests covering the handful of sample lines I have (chat, join, leave, PZ exception, death, perk gain).
- [ ] `lib/logs/store.ts`: `insertLogs(batch)`, `pruneOlderThan(ms)`, `listLogs({ kinds?, level?, q?, from?, to?, cursor? })`. Bulk inserts via `createMany({ data, skipDuplicates: true })` (content hash). Retention defaults to 14 days, env-overridable via new `LOGS_RETENTION_DAYS`.
- [ ] `lib/logs/ingester.ts`: owns the ingestion loop. Debounced batch inserts every 2 s or 500 lines. Registered in `server/ws.ts` alongside `installLogStreamer`.
- [ ] Start-up offset file: `<PZ_DATA_DIR>/.pz-crcon-state/logs-offset.json` — robust against missing dir / corrupted json (falls back to "now").
- [ ] `GET /api/logs` (MODERATOR+) — query params: `kind`, `level`, `q`, `from`, `to`, `cursor`, `limit` (max 500). Returns `{ logs, nextCursor }`.
- [ ] `GET /api/logs/export` (MODERATOR+) — streams CSV or JSONL (based on `?format=`), honouring the same filter.
- [ ] `components/logs/logs-history-view.tsx`: tab strip (all / server / chat / death / admin) + filter bar + infinite-scroll list. Mount alongside the existing live-tail viewer on `/admin/logs` (tab "Live" keeps the current `LogViewer`, new tab "History" uses the DB-backed view).
- [ ] `components/logs/log-filter-bar.tsx`: date range, level select, text search. URL-synced (`searchParams`) so deep-links work.
- [ ] Integration test `tests/integration/api.logs.test.ts`: inserts fixture rows, hits `GET /api/logs` with filters, checks cursor pagination.
- [ ] Unit tests for categoriser + store retention.

**Non-goal:** structured parse of every PZ log format. We tag what we can and
keep the raw line. A Phase 2.5 task can iterate on the classifier when we
have more real logs.

---

## Chunk 3 — Player Profile page

- [ ] `prisma/schema.prisma`: new model `PlayerNote { id, playerId, authorId, body, createdAt @@index([playerId, createdAt]) }`. Migration.
- [ ] `GET /api/players/:playerId` (VIEWER+) — returns `{ player, recentActions (last 50 AdminActions about this player), notes, sessions }`.
- [ ] `POST /api/players/:playerId/notes` (MODERATOR+, CSRF, Zod `{ body: string min(1) max(1000) }`). Returns new note.
- [ ] `DELETE /api/players/:playerId/notes/:noteId` (author OR ADMIN+).
- [ ] Ban dialog endpoint: replace inline ban button with a modal that POSTs `/api/players/:id/ban` with Zod `{ reason: string min(3), durationHours?: number }`. Compute `banExpiresAt = now + durationHours`. ADMIN+.
- [ ] Unban endpoint unchanged but the UI now clears the visible duration.
- [ ] `lib/players/playtime.ts`: `registerRollcall(names: string[])` keeps an in-memory `Map<name, joinedAt>` and emits `sessionClosed` events when a name disappears; persisted into `Player.totalPlaytime`. Wire into the existing `/api/players?online=true` path and/or a 30 s poll in `server/ws.ts`.
- [ ] Unit test `tests/unit/playtime.test.ts` verifies an online tick, a disappearance, a rejoin, all produce the right deltas.
- [ ] `/admin/players/[id]/page.tsx`: SSR header + client sub-components. Links out from `PlayersTable` rows (add "Open profile" action).
- [ ] `components/players/player-profile-header.tsx`: name, Steam link, online dot, playtime, deaths, country, last-seen.
- [ ] `components/players/player-notes.tsx`: list + "add note" textarea + delete-own-note button.
- [ ] `components/players/player-ban-dialog.tsx`: reason textarea, duration select (1 h / 1 d / 7 d / 30 d / permanent), confirm.
- [ ] `components/players/player-history.tsx`: chronological feed of `AdminAction`s targeting this player.
- [ ] Integration test `tests/integration/api.players-profile.test.ts`.

**Non-goal (Phase 4 takes over):** per-player death markers on the map,
perk breakdown, last-known coordinates trail. Phase 2 exposes them as bare
scalar columns only.

---

## Chunk 4 — Polish + chores

- [ ] `components/overview/activity-feed.tsx`: upgrade from polling to `events:admin` WS; when no WS message in 10 s fall back to poll. Publisher: every `AdminAction` insert in routes now additionally calls `publish("events:admin", { kind: "admin-action", ... })`.
- [ ] `components/overview/status-cards.tsx`: lightweight sparkline showing last 60 samples of players online (ring buffer fed by `/api/status` polls).
- [ ] Custom `/login` page (shadcn) replacing the default NextAuth screen — branded, shows server name + "Only allowlisted Discord IDs can log in".
- [ ] Add integration tests we know are missing: whitelist, quick actions, `/api/me/theme`, `/api/tiles` (path-traversal), `/api/players/positions`.
- [ ] `scripts/sync-mods.ts`: remove the "TEMPORARY default workshop list" placeholder — error out if `MOD_WORKSHOP_IDS` env or args missing.
- [ ] `docs/adr/0002-docker-socket-proxy.md`, `docs/adr/0003-auth-allowlist-vs-guild.md`, `docs/adr/0004-sse-vs-ws-for-positions.md` — short decision records capturing the choices already made.

---

## Acceptance criteria

A running Phase 2 build satisfies all of:

- [ ] OWNER can view, add, toggle, reorder, and remove Workshop mods from `/admin/mods`; changes persist to `servertest.ini` via atomic write with a `.bak-<iso>` created; restart prompt appears.
- [ ] `/admin/logs` shows both the live tail (existing) and a historical tab that filters by kind + level + free text + date range, with CSV + JSONL export.
- [ ] `/admin/players/[id]` shows profile, notes, history, and a rich ban dialog; `banExpiresAt` persists and expired bans auto-clear via a cron in a later phase (out of scope here — comment `// unban-on-expiry handled by phase3-schedules`).
- [ ] Playtime accumulates correctly for at least one simulated 10-minute session (unit test) and survives a server restart (the in-memory map is rebuilt from the last RCON roll-call).
- [ ] Activity feed updates live (WS) and degrades gracefully to polling.
- [ ] Prisma dropped `SandboxOverride` + `ServerEvent`; no reference remains in code or docs.
- [ ] Env validator rejects a missing `PZ_SERVER_PREFIX` in production (it currently silently defaults).
- [ ] All existing tests pass; new tests pass; coverage for new routes/components ≥ 80 %.

---

## Cut line (defer to later)

- Mod dependency / conflict graph (needs reading `mod.info` from disk).
- Chat log redaction rules (PII regex in `SandboxVars`-style UI).
- Ban appeal workflow and email notifications.
- Per-admin 2FA.
