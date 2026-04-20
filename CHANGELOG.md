# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/KasheK420/pz-crcon/compare/main...HEAD
