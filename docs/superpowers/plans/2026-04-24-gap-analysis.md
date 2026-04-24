# PZ-CRCON — Gap Analysis (Promised vs. Implemented)

**Date:** 2026-04-24
**Scope:** Every feature referenced in `README.md`, `CHANGELOG.md`, `docs/**`,
the four Phase plans, the three specs, and `prisma/schema.prisma` — cross-
referenced against the live code under `app/`, `components/`, `lib/`,
`server/`, `scripts/`, and `tests/`.

**Purpose:** Single source of truth for "what still needs to happen" before we
can honestly claim feature parity with the roadmap. Each row is a candidate
for a plan file under `docs/superpowers/plans/`.

> ### Executive summary
>
> - **Phase 1 MVP, 1.5 polish, 1.6 admin tools, and 1.7 config editor +
>   lifecycle are all shipped in code.** Phase 1.7 is the most surprising —
>   the code has the full editable INI + sandbox writer, CSRF-guarded
>   lifecycle routes (`start/stop/restart/abort/force-stop/reset-world`),
>   `AuditEvent` pipeline, and the `docker-socket-proxy` sidecar. Docs still
>   describe 1.7 as "planned".
> - **Phase 2 (operator suite)** is ~25 % done: mod metadata sync script
>   exists, but the admin `Mods`, `Logs (history)`, and `Player profile`
>   pages are absent. Persistent log storage is not implemented.
> - **Phase 3 (ops)** is ~0 % done. `Backup`, `Schedule`, and `ApiToken`
>   Prisma models exist but are unreferenced. No backup worker, no cron
>   scheduler, no settings page.
> - **Phase 4 (Lua mod + live map)** is ~5 % done. `WEBHOOK_HMAC_SECRET` is
>   validated in `lib/env.ts` but never read. The webhook endpoint, the
>   `WorldEvent` model, SSE positions, `/api/events`, and `/api/deaths` do
>   not exist. The companion Lua mod has not been written.
> - **Docs are drifting from reality.** `docs/architecture.md` is still the
>   Day-0 placeholder. `CHANGELOG.md` [Unreleased] mentions 1.5/1.6 but not
>   1.7. `README.md` markets "visual config editor" and server lifecycle as
>   future work even though both shipped.

---

## Legend

| Column | Meaning |
|--------|---------|
| **Promised by** | Shortest reliable citation (`README`, `CHANGELOG`, `plan-1.7`, `spec-live-map`, `schema`, …) |
| **Status** | ✅ shipped · 🟡 partial · ⬜ not started · ♻️ doc drift (shipped but docs say otherwise) |
| **Prio** | P0 / P1 / P2 / P3 — see *Priority heuristic* below |
| **Target plan** | Which new plan file should pick this up |

**Priority heuristic.** P0 = user-visible correctness / docs lying to users /
security or data-integrity. P1 = headline feature from the README roadmap
(mod manager, backups, Lua mod). P2 = nice-to-have inside a headline feature
(e.g. chat log export). P3 = explicitly deferred by the specs (Phase 5+).

---

## 1. Phase 1.7 — doc drift (ships today, docs lag)

Everything in this table is **already in production code**. The work is doc
updates, not engineering.

| Feature | Promised by | In code | Status | Prio | Action |
|---------|-------------|---------|--------|------|--------|
| Editable `server.ini` with diff + restart prompt | `plan-1.7`, `spec-config-editor` | `app/api/admin/config/ini/route.ts` (PUT), `components/config/*`, `lib/pz/writer.ts` | ♻️ | **P0** | Update `README.md`, `CHANGELOG.md` |
| Editable `SandboxVars.lua` (~130 keys) | `plan-1.7`, `spec-config-editor` | `app/api/admin/config/sandbox/route.ts` (PUT), `lib/pz/sandbox-descriptors.ts`, `lib/pz/serialize-sandbox-lua.ts` | ♻️ | **P0** | Update `README.md`, `CHANGELOG.md` |
| OWNER-only secrets reveal | `plan-1.7` chunk 4 | `app/api/admin/config/ini/secrets/route.ts` | ♻️ | **P0** | Mention in CHANGELOG |
| Atomic writes + `.backups/.bak-<iso>` chain | `plan-1.7` chunk 3 | `lib/pz/writer.ts` | ♻️ | **P0** | Document retention + recovery in `deployment.md` |
| Lifecycle: `start/stop/restart/force-stop/abort` | `plan-1.7` chunk 5 | `app/api/admin/server/{start,stop,restart,force-stop,abort,state}/route.ts`, `lib/server/lifecycle.ts` | ♻️ | **P0** | Update `README.md` feature list |
| `reset-world` (`wipeWorld` + trash dirs) | `deployment.md` §2.0, implied | `app/api/admin/server/reset-world/route.ts`, `lib/pz/world-reset.ts`, `components/server/danger-zone-card.tsx` | ♻️ | **P0** | Promote from "ops only" to a documented feature |
| `server:lifecycle` WS channel + phase badge | `plan-1.7` chunk 5 | `lib/ws/channels.ts`, `lib/server/lifecycle.ts`, `components/server/lifecycle-phase-badge.tsx` | ♻️ | **P1** | Update architecture doc |
| `AuditEvent` model + `/api/admin/audit` + UI card | `plan-1.7` chunk 4 | `prisma/schema.prisma`, `app/api/admin/audit/route.ts`, `components/audit/audit-card.tsx`, `lib/server/audit.ts` | ♻️ | **P1** | Document audit trail in README "Security" |
| CSRF double-submit on config + lifecycle mutations | `plan-1.7` | `lib/csrf/{check,fetch}.ts`; used in config + server routes | ♻️ | **P1** | Document CSRF in architecture.md |
| `tecnativa/docker-socket-proxy` sidecar + allowlist | `plan-1.7` chunk 1/5 | `docker/docker-compose.deploy.yml`, `lib/docker/control.ts`, `docs/deployment/pz-crcon-compose-phase1.7.yml` | ♻️ | **P1** | Replace ad-hoc socket `:ro` mention in README/architecture |

**Outcome:** after §1 of this gap plan, there is no drift left between
"what README claims" and "what code does" for Phase 1.x.

---

## 2. Phase 2 — Operator suite (partial)

| Feature | Promised by | In code today | Status | Prio | Target plan |
|---------|-------------|---------------|--------|------|-------------|
| Mod **metadata sync** (Workshop → `Mod` table) | `CHANGELOG` 1.5 | `scripts/sync-mods.ts` | ✅ | — | — |
| Mod **manager UI** (enable/disable, load order, conflict detection) | `README` roadmap, `spec-main` §10 | none | ⬜ | **P1** | `plan-phase2-mod-manager` |
| Mod **add-from-Workshop-URL** | `spec-main` §10 | none | ⬜ | **P2** | `plan-phase2-mod-manager` |
| Full **logs viewer** (chat, deaths, admin-actions history) with filter / search / export | `README`, `spec-main` §10 | Only live `logs:server` WS + `/admin/logs` tail | 🟡 | **P1** | `plan-phase2-logs` |
| **Persistent** log storage (ingest `docker logs` → DB or file rotation) | implied by filter/search/export | none | ⬜ | **P1** | `plan-phase2-logs` |
| Chat log viewer | `README` | none | ⬜ | **P1** | `plan-phase2-logs` |
| Death log viewer | `README` | none; `Player.deaths` counter unused | ⬜ | **P1** | `plan-phase2-logs` |
| Admin-actions history page | `README` | `/api/admin/actions` exists; only a 50-row card on `/admin` | 🟡 | **P2** | `plan-phase2-logs` |
| **Player profile page** (`/admin/players/:id`) | `README` | Only inline row actions | ⬜ | **P1** | `plan-phase2-player-profile` |
| Player **notes** (CRUD) | `Player.notes` column | column unused | ⬜ | **P2** | `plan-phase2-player-profile` |
| **Playtime tracking** | `Player.totalPlaytime` | never incremented | ⬜ | **P2** | `plan-phase2-player-profile` (depends on Lua mod for accurate sessions; can start with RCON `players` diff) |
| Ban **duration** UI (sets `banExpiresAt`) | `Player.banExpiresAt` | column unused; UI only does indefinite ban | 🟡 | **P2** | `plan-phase2-player-profile` |
| Ban **reason** in UI | `README` | backend accepts it; UI hardcodes "Banned via panel" | 🟡 | **P2** | `plan-phase2-player-profile` |
| **Custom `/login` page** | `plan-1` chunk 3 | uses default NextAuth page | ⬜ | **P3** | `plan-phase2-polish` |
| `StatusCards` sparklines (N-minute history) | `plan-1.5` | none | ⬜ | **P3** | `plan-phase2-polish` |
| Activity feed over WS (not polling) | `plan-1`, `spec-main` §6 | polls `/api/admin/actions` | 🟡 | **P3** | `plan-phase2-polish` |
| Public `JoinInfo` password reveal behind **Discord gate** | `README` public section | `JoinInfo` shows static text; no gate | ⬜ | **P2** | `plan-phase3-settings` (Discord config lives there) |

---

## 3. Phase 3 — Operations (not started)

| Feature | Promised by | In code today | Status | Prio | Target plan |
|---------|-------------|---------------|--------|------|-------------|
| **Backups** — manual trigger + download + restore | `README`, `spec-main` §10, schema `Backup` | none; `Backup` model unused | ⬜ | **P1** | `plan-phase3-backups` |
| **Scheduled** backups (cron) | `README`, `spec-main` §10 | none | ⬜ | **P1** | `plan-phase3-backups` |
| Retention policy (`BACKUP_RETENTION_DAYS`) | `deployment.md`, `env.ts` | `BACKUP_RETENTION_DAYS` validated in env but never read | 🟡 | **P1** | `plan-phase3-backups` |
| **Schedules** (restart with broadcast warnings, recurring events) | `README`, schema `Schedule` | `Schedule` model unused; no worker | ⬜ | **P1** | `plan-phase3-schedules` |
| Scheduled restart UI (`/admin/schedules`) | `spec-main` §10 | none | ⬜ | **P1** | `plan-phase3-schedules` |
| **Settings page** (`/admin/settings`) | `spec-main` §10 | none | ⬜ | **P1** | `plan-phase3-settings` |
| Discord **notification rules** (per-event toggles) | `spec-live-map` §5.7 | none | ⬜ | **P1** | `plan-phase3-settings` |
| Discord **outgoing webhook** (join/death/heli/backup/alert) | `README`, `spec-main` | none | ⬜ | **P1** | `plan-phase3-settings` |
| Discord **bot + slash commands** | `README` Phase 3/4 | none; `spec-main` §8 proposed but shipped auth is allowlist only | ⬜ | **P3** | `plan-phase3-settings` (stretch) |
| **User management** UI (list users, change role, revoke) | `spec-main` §10 | `User` table populated by OAuth only; no UI | ⬜ | **P1** | `plan-phase3-settings` |
| **API tokens** — create/list/revoke for non-browser WS | `ADR-0001`, schema `ApiToken` | `ApiToken` model unused; no routes | ⬜ | **P2** | `plan-phase3-settings` |
| Theme overrides across users (OWNER sets defaults) | `spec-main` §8 | Only per-user `themePrefs` via `/api/me/theme` | ⬜ | **P3** | `plan-phase3-settings` |

---

## 4. Phase 4 — Lua mod + live map (~5 % done)

| Feature | Promised by | In code today | Status | Prio | Target plan |
|---------|-------------|---------------|--------|------|-------------|
| `POST /api/webhook/mod` with HMAC verification | `spec-main` §7, `spec-live-map` | none; `WEBHOOK_HMAC_SECRET` env validated but unread | ⬜ | **P1** | `plan-phase4-ingest` |
| In-memory live position store | `spec-live-map` §5.2 | none; `/api/players/positions` returns placeholder coords | ⬜ | **P1** | `plan-phase4-ingest` |
| `WorldEvent` Prisma model (deaths, heli, generator, chat) | `spec-live-map` §5.2 | **not in schema** | ⬜ | **P1** | `plan-phase4-ingest` |
| `/api/events` (last N world events) | `spec-live-map` §7 | none | ⬜ | **P1** | `plan-phase4-ingest` |
| `/api/deaths` (last N deaths with coords) | `spec-live-map` §7 | none | ⬜ | **P2** | `plan-phase4-ingest` |
| SSE `/api/stream/positions` (anonymised public + full admin) | `spec-live-map` §5.3 | none; public Leaflet polls REST every 2-3 s | ⬜ | **P1** | `plan-phase4-live-map` |
| `WorldEvent` → `events:admin` WS push | `spec-main` §6, `spec-live-map` | channel exists, nothing publishes | 🟡 | **P2** | `plan-phase4-live-map` |
| Public map anonymisation (250-tile grid, hidden names, 30 s tick) | `spec-live-map` §5.4 | N/A (no live data yet) | ⬜ | **P2** | `plan-phase4-live-map` |
| Death markers / event overlay on Knox map | `spec-live-map` | none | ⬜ | **P2** | `plan-phase4-live-map` |
| Companion **Lua mod** source (`mods/pz-crcon/`) | `README`, `spec-main` §7 | **not in repo** | ⬜ | **P1** | `plan-phase4-lua-mod` |
| `PZCrcon.cfg` (endpoint, token, heartbeat, batch) | `spec-main` §7 | — | ⬜ | **P1** | `plan-phase4-lua-mod` |
| Steam Workshop listing for the mod | `README` | — | ⬜ | **P2** | `plan-phase4-lua-mod` |
| HMAC secret **rotation** (`PZCRCON_SECRET_NEXT`) | `spec-live-map` §13 | — | ⬜ | **P3** | `plan-phase4-ingest` |
| Honest `/api/status` in-game day + weather | `README` status widget | Only RCON-derivable fields; day/weather blank | 🟡 | **P2** | `plan-phase4-ingest` |
| Uptime from Lua heartbeat | `README` | Uses "first RCON connect"; close enough | 🟡 | **P3** | — |

**Explicit Phase 5+ non-goals** (tracked for completeness, do **not** plan yet):
trails, heatmap, POI editor, replay, mobile push, fast admin-only position
tick.

---

## 5. Unused / scaffolding-only Prisma models

| Model | Referenced by code? | Role in roadmap | Verdict |
|-------|---------------------|-----------------|---------|
| `PlayerEvent` | No | Per-player timeline (spec-main) | Keep — picked up by `plan-phase4-ingest` |
| `Backup` | No | `plan-phase3-backups` | Keep |
| `Schedule` | No | `plan-phase3-schedules` | Keep |
| `ApiToken` | No | `plan-phase3-settings` | Keep |
| `SandboxOverride` | No | Alternate (staged) sandbox editing path from the original spec; **superseded** by Phase 1.7 writer which edits the file directly | **Drop** after a short deprecation note, or repurpose for "pending-on-restart" queue |
| `ServerEvent` | No | Generic server-wide event bus from the original spec; overlaps with Phase 4 `WorldEvent` | **Drop** and adopt `WorldEvent` |

---

## 6. Test coverage gaps

| Area | Current | Gap |
|------|---------|-----|
| Integration `/api/whitelist` | — | Add happy-path + zod-reject |
| Integration `/api/players/*` (kick/ban/unban) | — | Add role + audit assertions |
| Integration `/api/admin/quick` | — | Add per-action role gate |
| Integration `/api/me/theme` | — | Add PATCH zod-reject |
| Integration `/api/tiles` | — | Add path-traversal rejection |
| Integration `/api/players/positions` | — | Add online-vs-offline snapshot |
| Integration `/api/webhook/mod` (Phase 4) | — | HMAC required |
| Playwright E2E | — | Deferred by `plan-1` |

---

## 7. Env vars declared but unused

From `lib/env.ts` vs the codebase:

| Var | Reserved for |
|-----|--------------|
| `WEBHOOK_HMAC_SECRET` | `plan-phase4-ingest` |
| `BACKUP_PATH` | `plan-phase3-backups` |
| `BACKUP_RETENTION_DAYS` | `plan-phase3-backups` |

Vars used in code but **not** declared in `lib/env.ts` (should be added to
the validator so prod startup catches missing values):

`PZ_CONTAINER_NAME`, `PZ_SERVER_CONTAINER`, `PZ_CRCON_CONTAINER`,
`PZ_CONFIG_DIR`, `PZ_SERVER_DIR`, `PZ_BACKUP_DIR`, `PZ_DATA_DIR`,
`PZ_SERVER_PREFIX`, `PZ_TILES_DIR`, `DOCKER_SOCKET_PATH`,
`DOCKER_CONTROL_URL`, `NEXT_PUBLIC_PZ_TILE_URL`, `NEXT_PUBLIC_PZ_MIN_X`,
`NEXT_PUBLIC_PZ_MIN_Y`, `NEXT_PUBLIC_PZ_MAX_X`, `NEXT_PUBLIC_PZ_MAX_Y`,
`PUBLIC_SERVER_NAME`, `PUBLIC_SERVER_ADDRESS`, `PUBLIC_DISCORD_URL`,
`PUBLIC_MAX_PLAYERS`, `PORT`, `MOD_WORKSHOP_IDS`.

**Action:** extend `lib/env.ts` with a new `optionalPzEnv()` block — tracked
under `plan-phase2-polish`.

---

## 8. Documentation gaps

| File | Problem | Action |
|------|---------|--------|
| `docs/architecture.md` | Day-0 placeholder with "open decisions" long since closed | Rewrite in `plan-gap-docs-sweep` |
| `CHANGELOG.md` [Unreleased] | Missing Phase 1.7 entirely | Append Phase 1.7 section |
| `README.md` "Planned Features" | Lists visual config editor + lifecycle + audit as future | Move to "Shipped"; leave mod mgr / logs / backups / schedules / Discord / Lua as roadmap |
| `README.md` "Status" | Says "Phase 1 MVP shipped" | Bump to "Phase 1.7 shipped" |
| `README.md` "Architecture" diagram | Flat "PZ server ↔ pz-crcon ↔ Web UI" — omits docker-socket-proxy, shared `pz-data` volume, NPM + Cloudflare | Redraw |
| `docs/deployment.md` | Missing backup-file recovery, audit-log retention, CSRF cookie rotation, `reset-world` runbook | Append troubleshooting entries |
| `docs/adr/` | Only ADR-0001. Missing ADRs: "docker-socket-proxy vs shared socket", "Phase 4 SSE vs WS", "allowlist auth vs Discord guild" | Add three ADRs |

---

## 9. Proposed new plans (this gap report will spawn)

1. **`2026-04-24-phase2-operator-suite.md`** — mod manager, persistent logs viewer, player profile + notes + ban duration/reason, minor polish, env-var validator extension.
2. **`2026-04-24-phase3-ops.md`** — backups, schedules, settings (Discord notifications, user management, API tokens).
3. **`2026-04-24-phase4-live-data.md`** — webhook ingest, `WorldEvent`, SSE positions, public anonymisation, companion Lua mod.
4. **`2026-04-24-docs-sweep.md`** — catch-up doc changes (README, CHANGELOG, architecture.md, three new ADRs, deployment addenda). Executed as part of this same chat.

---

## 10. Recommended execution order

| # | Plan | Why first / why later | Blocker for |
|---|------|------------------------|-------------|
| 1 | `docs-sweep` | Stop the bleeding; new users read lies otherwise | Everything public-facing |
| 2 | `phase2-operator-suite` — mod manager + player profile | Highest-value user-facing gaps; both independent from Lua mod | — |
| 3 | `phase2-operator-suite` — logs (persistent + full viewer) | Needed before Discord notifications can reference events | `phase3-settings` notification rules |
| 4 | `phase3-backups` | Safety net before anyone schedules automated restarts | `phase3-schedules` (retention interplay) |
| 5 | `phase3-schedules` | Requires lifecycle (shipped) + backups (P3.1) | — |
| 6 | `phase3-settings` | Closes Phase 3; opens Discord notifications | `phase4-live-data` (death alerts reuse this) |
| 7 | `phase4-lua-mod` + `phase4-ingest` in parallel | Both sides of the webhook contract; write together | `phase4-live-map` |
| 8 | `phase4-live-map` | SSE, anonymisation, overlays | — |

After all of the above, **v0.5.0 "feature-complete"** is a reasonable tag.
