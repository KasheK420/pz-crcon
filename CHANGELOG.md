# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
