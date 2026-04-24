# PZ-CRCON

> A modern, open-source web admin panel for **Project Zomboid** dedicated servers — with live world map, Discord OAuth, real-time monitoring, and a public-facing community page.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Project status: v0.3.0 Phase 2+3](https://img.shields.io/badge/status-v0.3.0%20Phase%202%2B3-blue.svg)](#status)
[![Project Zomboid: Build 42](https://img.shields.io/badge/PZ-Build%2042-green.svg)](https://projectzomboid.com)

---

## What is this?

`pz-crcon` is a self-hostable, Dockerized web admin panel for Project Zomboid (B41 + B42) dedicated servers. Inspired by [CRCON for Hell Let Loose](https://github.com/MarechJ/hll_rcon_tool), [Pterodactyl](https://pterodactyl.io/), and [AMP](https://cubecoders.com/AMP), but built **PZ-first** — no awkward Minecraft-flavored compromises.

It also ships with an optional **server-side Lua mod** that streams live player positions, deaths, chat, and world events out to the panel — enabling a public community map page, Discord notifications, and real analytics.

## Status

**v0.3.0 — Phase 2 + most of Phase 3 shipped.** Live at <https://pz.majorluk.pl>.

See [`docs/superpowers/plans/2026-04-24-gap-analysis.md`](docs/superpowers/plans/2026-04-24-gap-analysis.md)
for the current shipped-vs-planned matrix and links to the three active
phase plans.

### Shipped

- Discord OAuth login (allowlist via `DISCORD_ADMIN_IDS` — first ID becomes
  OWNER, rest become ADMIN; no Discord bot or guild required)
- Public map page (server status, mod list, Leaflet Knox County map with
  tile-server fallback, anonymous access)
- Admin overview dashboard with host stats (CPU/RAM), approximate TPS,
  honest uptime, and a live activity feed
- **Live RCON terminal** with WebSocket-streamed output, full PZ command
  catalog (45 commands across 8 categories), role gating, cheat-sheet
  sidebar, one-click "insert example"
- **Player management** — list, kick, ban, unban (audit-logged) plus a
  Steam-ID-based **whitelist registry** at `/admin/whitelist`
- **Live server log stream** at `/admin/logs` (`logs:server` WS, filter,
  pause, clear, export)
- **Read-only startup config viewer** at `/admin/startup` (OWNER+) —
  Docker image, entrypoint, env vars, mounts, sensitive values masked
- **Visual config editor** at `/admin/config` (VIEWER+ read, OWNER write) —
  editable `server.ini` and `SandboxVars.lua` with typed controls,
  diff modal, OWNER-only secret reveal, atomic writes with `.bak-<iso>`
  backups, and restart prompt
- **Server lifecycle controls** — start / stop / restart (with save) /
  force-stop (OWNER, typed confirm) / abort, plus `reset-world`
  (`wipeWorld` + trash rename). Uses an isolated
  [`tecnativa/docker-socket-proxy`](https://github.com/Tecnativa/docker-socket-proxy)
  sidecar with an explicit endpoint allowlist — the main process never
  touches the raw Docker socket for mutations
- **Audit trail** — every config write + lifecycle op recorded in
  `AuditEvent`, surfaced on the admin overview
- **CSRF double-submit** guard on all admin mutations
- 🧩 **Mod manager** at `/admin/mods` — add by numeric Workshop ID or
  full URL, enable/disable (drops from INI without losing DB row),
  ↑↓ reorder, refresh metadata from Steam, and **Import Workshop
  collection** with optional replace-all. Rewrites `WorkshopItems=`
  + `Mods=` through the existing atomic INI writer with three-way
  merge preserved; DB is source-of-truth, INI is a materialised view
  with a "drift" banner when the two diverge
- 💾 **Backup manager** at `/admin/backups` — on-demand `tar.gz`
  snapshots of `Saves/Multiplayer/<prefix>` + configs + user DB, list
  / create / download / delete for ADMIN, restore gated behind OWNER
  and refuses while PZ is running (pre-restore rename lets you
  revert). Retention: MANUAL / PRE_RESTART kept forever, AUTO pruned
  to newest 14
- ⏰ **Schedules** at `/admin/schedules` — cron runner living on the
  pz-crcon WS process (minute granularity, no catch-up after
  restart), four action kinds: `announce` (servermsg broadcast),
  `restart` (graceful), `restart-warn` (countdown with intermediate
  broadcasts), `auto-backup`. One-click **Fire now** for ad-hoc runs
- ⚙️ **Settings** at `/admin/settings` — env-var view grouped by
  concern (Public site / PZ server / RCON / Discord / Phase 4
  webhook) + OWNER-only **API token** management (SHA-256 hashed,
  prefix lookup, scopes list, optional expiry, one-shot reveal)

### Planned (roadmap)

Three plan files drive the remaining work. Each is concrete, chunked,
and tracked with `- [ ]` checkboxes.

- **[Phase 2 — Operator Suite](docs/superpowers/plans/2026-04-24-phase2-operator-suite.md)** remaining bits (→ v0.3.1)
  - 📜 Persistent log viewer (chat / death / admin tabs with filter + search + CSV/JSONL export) — live tail already ships; history persistence + DB-backed queries are next
  - 👤 Player profile page (`/admin/players/[id]`) with notes, ban
    duration + reason dialog, and session-diff playtime tracking
  - Custom `/login` page, `StatusCards` sparklines, activity feed over WS
- **[Phase 3 — Ops](docs/superpowers/plans/2026-04-24-phase3-ops.md)** remaining bits (→ v0.4.0)
  - 🔔 Discord outgoing webhook with per-event toggles (join/leave/death/lifecycle/backup)
  - 👥 User management tab in Settings (role changes, last-OWNER invariant, revoke)
- **[Phase 4 — Live Data](docs/superpowers/plans/2026-04-24-phase4-live-data.md)** (→ v0.5.0)
  - 📡 Companion **Lua mod** (`mods/pz-crcon/`) — periodic HMAC-signed
    batched webhook with positions, deaths, helicopter / generator /
    chat events
  - 🗺️ **SSE `/api/stream/positions`** — anonymised (250-tile grid, 30 s
    tick) for the public, precise (2 s tick) for admins
  - New `WorldEvent` Prisma model, `/api/events`, `/api/deaths`
  - Discord notifications fire on real game events
  - Death markers + event overlay on the Knox map
  - 🎫 "How to join" password reveal behind the Discord gate

See [project board](https://github.com/KasheK420/pz-crcon/projects) and
[discussions](https://github.com/KasheK420/pz-crcon/discussions).

## Architecture

```
                   Cloudflare DNS + Tunnel
                              │
                              ▼
           ┌──────────────────────────────────┐
           │         nginx-proxy-manager      │
           └───────────────┬──────────────────┘
                           │ proxy-net
                           ▼
┌──────────────────────────────────────────────────────┐
│                  pz-crcon (Next 15)                  │
│                                                      │
│  app/ ── (admin) + (public) + api/ routes            │
│  server/ws.ts ── custom Node server, attaches WS     │
│     ├─ rcon:output     (MODERATOR+)                  │
│     ├─ logs:server     (MODERATOR+, tails docker)    │
│     └─ server:lifecycle(VIEWER+)                     │
│                                                      │
│  lib/                                                │
│   ├─ auth   Discord OAuth allowlist (next-auth 5)    │
│   ├─ rcon   client + command catalog (45 cmds)       │
│   ├─ docker ── dockerode (unix sock, RO reads)       │
│   │      └── control via TCP to socket-proxy         │
│   ├─ pz     parse / serialize / writer / validate    │
│   ├─ server lifecycle orchestrator + audit           │
│   └─ csrf   double-submit against NextAuth cookie    │
└──────┬───────────┬─────────────┬─────────────────────┘
       │           │             │
       │ RCON      │ /var/run/   │ TCP 2375 (allowlisted)
       │ (public   │  docker.sock│
       │  IP,      │  :ro        │
       │  ADR-0001)│             │
       ▼           ▼             ▼
 ┌───────────┐ ┌────────────┐ ┌───────────────────────┐
 │ pz-server │ │ host Docker│ │ tecnativa/            │
 │ container │ │ (reads     │ │ docker-socket-proxy   │
 │ + shared  │ │  stats/    │ │ (CONTAINERS=1,        │
 │ pz-data   │ │  inspect/  │ │  POST=1, allow        │
 │ volume RW │ │  logs)     │ │  start/stop/restart)  │
 └───────────┘ └────────────┘ └───────────────────────┘
       │
       │ Postgres TCP
       ▼
 ┌────────────────┐
 │ shared-postgres│  ── Prisma 5 schema
 └────────────────┘     User, Player, AdminAction,
                        AuditEvent, Mod, Backup,
                        Schedule, ApiToken, ...
```

**Key decisions** (ADRs in [`docs/adr/`](docs/adr/)):

- RCON over the public IP because the bridge container can't reach host
  networking (see [ADR-0001](docs/adr/0001-bridge-network-rcon.md)).
- Mutating Docker operations go through `tecnativa/docker-socket-proxy`
  with an explicit endpoint allowlist; reads use `/var/run/docker.sock:ro`.
- Auth is a static `DISCORD_ADMIN_IDS` allowlist (first id = OWNER, rest =
  ADMIN). No Discord bot, no guild check.
- Config writes are atomic (tmp → fsync → rename) with `.bak-<iso>` kept
  in a sibling `.backups/` dir, gated by a process-level mutex.
- Config + lifecycle mutations require CSRF double-submit against the
  NextAuth cookie.

Phase 4 will add an SSE stream for map positions and an HMAC-signed
webhook ingester for the companion Lua mod.

See [`docs/architecture.md`](docs/architecture.md) for the full write-up
and [`docs/deployment.md`](docs/deployment.md) for the operator runbook.

## Quick Start

### Run the prebuilt image (recommended)

```bash
mkdir -p pz-crcon && cd pz-crcon
curl -O https://raw.githubusercontent.com/KasheK420/pz-crcon/main/docker/docker-compose.deploy.yml
mv docker-compose.deploy.yml docker-compose.yml
curl -O https://raw.githubusercontent.com/KasheK420/pz-crcon/main/.env.example
cp .env.example .env
# fill in: NEXTAUTH_SECRET, DATABASE_URL, DISCORD_CLIENT_ID/SECRET,
#          DISCORD_ADMIN_IDS (your Discord user ID), RCON_*
docker compose up -d
docker exec -it pz-crcon npx prisma migrate deploy
```

Open <http://localhost:3000>, sign in with Discord, and you're in.

### Local dev from source

```bash
git clone https://github.com/KasheK420/pz-crcon.git
cd pz-crcon
cp .env.example .env  # fill in
docker compose -f docker/docker-compose.yml up -d  # local Postgres only
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm dev
```

### Auth model (no Discord bot required)

Authorization is a static allowlist: `DISCORD_ADMIN_IDS` is a
comma-separated list of Discord numeric user IDs. The **first** ID
becomes `OWNER` on first login; the rest become `ADMIN`. Anyone not
listed is rejected at the OAuth callback. No bot token, no guild check,
no role management — just an env var.

## Contributing

Yes please! See [CONTRIBUTING.md](CONTRIBUTING.md). All contributors are expected to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

Good first issues will be tagged `good first issue` once the architecture is settled.

## Security

Found a vulnerability? Please **don't** open a public issue — see [SECURITY.md](SECURITY.md) for responsible disclosure.

## License

[MIT](LICENSE) © 2026 Lukas Majoros and contributors

## Acknowledgements

- [The Indie Stone](https://projectzomboid.com/) for Project Zomboid
- [CRCON for Hell Let Loose](https://github.com/MarechJ/hll_rcon_tool) for the architectural inspiration
- [Renegade-Master/zomboid-dedicated-server](https://github.com/Renegade-Master/zomboid-dedicated-server) for the reference Docker image
