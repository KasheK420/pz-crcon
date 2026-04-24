# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added — Phase 2: Operator suite (mods, backups, schedules, settings)
- `/admin/mods` — workshop-driven mod manager. Add by numeric ID or
  URL, enable/disable (drops from INI without losing DB row), ↑/↓
  reorder, delete, refresh Steam metadata, and bulk **import Workshop
  collection** with optional replace-all. Rewrites `WorkshopItems=`
  and `Mods=` in the live server.ini through the existing atomic
  writer (three-way merge preserved). DB is source of truth; INI is
  a materialised view with a "drift" banner when the two diverge.
- `/admin/backups` — on-demand tar.gz snapshots of `Saves/Multiplayer`
  + server config + user DB. List / create / download / delete for
  ADMIN; restore gated behind OWNER and refuses while the PZ
  container is running (pre-restore trash rename lets you revert).
  Retention: MANUAL and PRE_RESTART kept forever, AUTO pruned to
  newest 14.
- `/admin/schedules` — cron-driven recurring actions, runner lives on
  the pz-crcon WS process and ticks at minute granularity. Four
  action kinds: `announce` (servermsg broadcast), `restart` (graceful
  restart), `restart-warn` (countdown with intermediate servermsg
  breakpoints), `auto-backup`. One-click **Fire now** for ad-hoc
  manual runs and payload editing. UTC-clocked, no missed-tick
  catch-up after a crcon restart.
- `/admin/settings` — read-only env-var view grouped by concern
  (Public site / PZ server / RCON / Discord / Phase 4 webhook) plus
  OWNER-only **API token** management: SHA-256 hashed tokens with
  prefix lookup, configurable scopes list, optional expiry. Raw
  token value shown exactly once at creation. Reserved for the
  Phase 4 Lua companion mod webhook.
- Sidebar picks up Mods, Backups, Schedules, Settings under
  admin group.

### Changed
- `.gitignore` narrowed the blanket `backups/` entry to `/backups/`
  so source directories named `backups/` (new `components/backups/`)
  are tracked again.
- `server/ws.ts` now kicks off the schedule runner at boot alongside
  the WS attach and log streamer.

### Added — Phase 1.7: Config editor, server controls & logs fix
- Editable `<prefix>.ini` via `PUT /api/admin/config/ini` (OWNER, CSRF) —
  typed per-key controls, live diff modal, restart prompt, atomic writes
  (tmp → fsync → rename) with per-save `.bak-<iso>` chain in a sibling
  `.backups/` dir, gated by a process-level mutex and a
  "lifecycle must be idle" check so pz-server's shutdown-flush cannot
  race the panel
- Editable `<prefix>_SandboxVars.lua` via `PUT /api/admin/config/sandbox`
  (OWNER, CSRF) — offset-based splicing so unrelated lines, comments,
  and formatting survive unchanged
- OWNER-only secret reveal at `GET /api/admin/config/ini/secrets` —
  non-OWNER always see redacted values on the main GET
- Server lifecycle controls: `POST /api/admin/server/{start,stop,
  restart,abort,force-stop,reset-world}` (ADMIN+, `force-stop` and
  `reset-world` OWNER-only with typed confirmation), plus
  `GET /api/admin/server/state` for phase + container + RCON + uptime
- `ServerControlsCard` on `/admin` and the config page, with a
  `LifecyclePhaseBadge` driven by a new `server:lifecycle` WS channel
  and a `DangerZoneCard` on `/admin/config`
- `AuditEvent` Prisma model + `AuditKind` enum
  (`CONFIG_WRITE`, `LIFECYCLE_START`, `LIFECYCLE_STOP`,
  `LIFECYCLE_RESTART`, `LIFECYCLE_FORCE_STOP`, `LIFECYCLE_ABORT`) —
  every config write and lifecycle op is persisted and paginated via
  `GET /api/admin/audit` (MODERATOR+); surfaced on the overview as
  an `AuditCard`
- CSRF double-submit pattern for admin mutations (`lib/csrf/check.ts` +
  `lib/csrf/fetch.ts`) against the Auth.js CSRF cookie family
- Isolated `tecnativa/docker-socket-proxy` sidecar with explicit endpoint
  allowlist (`CONTAINERS=1`, `POST=1`, `START=1`, `STOP=1`, `RESTART=1`,
  `KILL=1`) for all mutating Docker ops — the app container no longer
  needs to touch the raw socket for start/stop/kill
- `lib/server/lifecycle.ts` — RCON-first graceful flow (warning →
  `save` → `quit` → wait exited → optional snapshot restore → docker
  start), with `abort` only affecting the `warning` phase by design
- `lib/pz/world-reset.ts` (`wipeWorld` + trash rename) and
  `lib/pz/snapshot.ts` (snapshot / restore config around shutdown)
- `lib/pz/ini-descriptors.ts` expanded to ~120 entries and a new
  `lib/pz/sandbox-descriptors.ts` with ~130 entries, both driving the
  Zod validator
- Integration coverage: `tests/integration/api.config.test.ts`,
  `tests/integration/api.server.test.ts`, and a
  `tests/integration/docker-proxy.endpoints.test.ts` smoke job
- Production `pz-data` bind-mount flipped to RW (see `docs/deployment.md`
  §2.0 — requires a one-off `chown -R 1000:1000` on the shared volume)

### Changed — Phase 1.7
- `/admin/logs` viewer works in production again — the WS log-streamer
  now opens the Docker socket on boot via `installLogStreamer()` and
  surfaces the failure mode clearly when the socket or container is
  missing
- `lib/ws/channels.ts`: added `server:lifecycle` (VIEWER+). The
  existing `players:positions` channel stays a placeholder until the
  Phase 4 ingest lands

### Added — Phase 1.6: Admin tools
- Full RCON command catalog expanded from 19 to 45 commands
  (`lib/rcon/commands.ts`) with categories (server / player / chat /
  world / moderation / whitelist / debug / replay) and example payloads
- Categorised cheat-sheet sidebar on `/admin/rcon` with collapsible
  sections, search, role gating, and one-click "Insert example"
  buttons that paste into the terminal input
- Live param hint under the RCON terminal input showing the current
  command's signature and required role
- New `/admin/startup` page (OWNER+) — read-only view of the pz-server
  container's image, entrypoint, command, env vars, restart policy,
  and bind mounts; sensitive values auto-masked
- New `/admin/config` page (VIEWER+) — two tabs reading the live
  `<servername>.ini` and `<servername>_SandboxVars.lua` from the
  pz-server container with parsed key/value display, hint descriptions,
  and "requires restart" tags
- New `/admin/whitelist` page (ADMIN+) — Steam ID-based whitelist
  registry with add form, source-of-truth table, audit log entries,
  and best-effort `removeuserfromwhitelist` RCON invocation when a
  real username is known
- New `lib/pz/parse-ini.ts`, `lib/pz/parse-sandbox-lua.ts`, and
  `lib/pz/config-reader.ts` (regex-based parsers + dockerode `cat`
  reader, with unit tests)
- New `lib/docker/client.ts` helpers: `inspectContainer`, `envMapFrom`,
  and `readContainerFile` (multiplexed-frame demuxing of dockerode
  exec output)
- New `app/api/whitelist` (GET/POST/DELETE) with Steam ID validation,
  zod request bodies, and `AdminAction` audit rows
- Sidebar entries for Whitelist / Server Config / Startup Config

### Changed — Phase 1.6
- `Player` model: added `whitelistedAt: DateTime?` and
  `whitelistedById: String?` columns to track who whitelisted a player
  and when (apply via `pnpm prisma db push` on prod)
- `RconCommandSpec` now includes `category` and `examples` fields
- RCON terminal extracted into `RconShell` so the cheat sheet can drive
  the input via a `useImperativeHandle` ref

### Added — Phase 1.5: Polish & Observability
- PZ-themed favicon (`app/icon.svg` + `app/apple-icon.svg`) and OpenGraph
  / Twitter card SVG for richer link previews
- Native Leaflet Knox County map with tile-server fallback
  (`pzmap.crash-override.net` → `map.projectzomboid.com`) and player
  markers fed from `/api/players/positions` (placeholder coords until the
  Phase 4 Lua mod ships real ones)
- Legacy iframe map kept at `/map-legacy` for quick comparison
- `/api/admin/host-stats` (VIEWER+) — pz-server and pz-crcon container
  memory + CPU via `dockerode` over read-only `/var/run/docker.sock`
- Live console log streaming: new `logs:server` WS channel + `/admin/logs`
  page with filter / pause / clear / export, ANSI codes stripped
- Approximate TPS scraping from PZ logs surfaced on `/api/status`
- "Server join info" card on `/admin` overview
- `scripts/sync-mods.ts` — one-shot Steam Workshop metadata refresher
  (`MOD_WORKSHOP_IDS` env or CLI args, batches of 100)
- Honest uptime: `/api/status` now reports time since first RCON connect
  when available, falling back to process start

### Changed
- Public landing default map is now the Leaflet implementation
- Status cards expanded to two rows including TPS and container memory
- Production compose mounts `/var/run/docker.sock:/var/run/docker.sock:ro`
  with rationale documented in `SECURITY.md`

### Initial repository scaffolding
- Initial repository scaffolding (README, LICENSE, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY)
- GitHub issue and PR templates
- CI, security scanning, and secret scanning workflows
- Dependabot configuration
- Branch protection on `main`

### Planned for 0.1.0
- Minimum viable admin panel: RCON terminal, player list, live monitoring, basic logs
- Docker Compose deployment
- Discord OAuth authentication
- Documentation covering setup and configuration

### Planned for 0.3.0 (Phase 2 — Operator suite)
See [`docs/superpowers/plans/2026-04-24-phase2-operator-suite.md`](docs/superpowers/plans/2026-04-24-phase2-operator-suite.md).
- Mod manager UI (enable/disable, reorder, add from Workshop URL)
- Persistent log viewer (chat / death / admin tabs with filter, search, export)
- Player profile page at `/admin/players/[id]` with notes, ban duration/reason, session-diff playtime
- Env validator extended to all `PZ_*` / `PUBLIC_*` / `DOCKER_*` variables
- Dropped unused `SandboxOverride` and `ServerEvent` Prisma models

### Planned for 0.4.0 (Phase 3 — Ops)
See [`docs/superpowers/plans/2026-04-24-phase3-ops.md`](docs/superpowers/plans/2026-04-24-phase3-ops.md).
- Backups: manual + cron-scheduled, download, restore (triple-confirm), retention
- Schedules: cron-driven restart + broadcast / backup / custom-RCON, advisory-locked runner
- Settings page: Discord outgoing webhook + per-event rules, user role management, API tokens

### Planned for 0.5.0 (Phase 4 — Live data)
See [`docs/superpowers/plans/2026-04-24-phase4-live-data.md`](docs/superpowers/plans/2026-04-24-phase4-live-data.md).
- Companion Lua mod (`mods/pz-crcon/`) posting HMAC-signed batched
  webhooks with positions, deaths, helicopter / generator / chat events
- SSE `/api/stream/positions` (anonymised public, precise admin)
- `WorldEvent` model, `/api/events`, `/api/deaths`
- Death markers + event overlay on the Knox map
- Discord notifications on real game events

[Unreleased]: https://github.com/KasheK420/pz-crcon/compare/main...HEAD
