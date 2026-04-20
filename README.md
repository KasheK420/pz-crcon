# PZ-CRCON

> A modern, open-source web admin panel for **Project Zomboid** dedicated servers — with live world map, Discord OAuth, real-time monitoring, and a public-facing community page.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Project status: v0.1.0 MVP](https://img.shields.io/badge/status-v0.1.0%20MVP-blue.svg)](#status)
[![Project Zomboid: Build 42](https://img.shields.io/badge/PZ-Build%2042-green.svg)](https://projectzomboid.com)

---

## What is this?

`pz-crcon` is a self-hostable, Dockerized web admin panel for Project Zomboid (B41 + B42) dedicated servers. Inspired by [CRCON for Hell Let Loose](https://github.com/MarechJ/hll_rcon_tool), [Pterodactyl](https://pterodactyl.io/), and [AMP](https://cubecoders.com/AMP), but built **PZ-first** — no awkward Minecraft-flavored compromises.

It also ships with an optional **server-side Lua mod** that streams live player positions, deaths, chat, and world events out to the panel — enabling a public community map page, Discord notifications, and real analytics.

## Status

**v0.1.0 — Phase 1 MVP shipped.** Live at <https://pz.majorluk.pl>.

What works today:

- Discord OAuth login (allowlist via `DISCORD_ADMIN_IDS` — first ID becomes OWNER, rest become ADMIN; no Discord bot or guild required)
- Public map page (server status, mod list, anonymous access)
- Admin overview dashboard
- Live RCON terminal with WebSocket-streamed output
- Player list with kick/ban via UI (audit-logged)

Phases 2–4 (visual config editor, mod manager, logs viewer, backups, schedules, Lua mod webhook) are on the roadmap below. See [project board](https://github.com/KasheK420/pz-crcon/projects) and [discussions](https://github.com/KasheK420/pz-crcon/discussions).

## Planned Features

### Admin Panel (auth-gated)
- 🎮 **Live RCON terminal** — full PZ command set, autocomplete, macros, history
- 👥 **Player management** — whitelist, ban (with reasons + duration), kick, admin levels, profile view, playtime stats
- 📊 **Real-time monitoring** — players online, TPS, RAM/CPU, uptime, events feed
- 📜 **Logs viewer** — server, chat, deaths, admin actions, with filter + search + export
- ⚙️ **Visual config editor** — sandbox vars (~200 settings) and server.ini with diffs and "apply on restart"
- 🧩 **Mod manager** — Workshop sync, enable/disable, conflict detection, load order
- 💾 **Backup management** — manual + scheduled, download, restore, retention
- ⏰ **Schedules** — restarts with broadcast warnings, recurring events
- 🔔 **Discord integration** — notifications + slash commands

### Public Live Map (anonymous)
- 🗺️ **Interactive Knox County map** with live player position dots
- 📡 **Server status** widget (uptime, players, weather, in-game time)
- 📋 **Mod list** with Workshop links
- 🎫 **"How to join"** flow with Discord verification gate for the password

### Companion PZ Mod
- Pure Lua, server-side only
- Periodic webhook → admin panel
- Player coords, deaths, chat, helicopter events, generators
- Zero performance impact when panel is offline

## Architecture (planned)

```
┌────────────────────┐    ┌─────────────────┐    ┌──────────────────┐
│  PZ Dedicated      │───▶│  pz-crcon API   │◀──▶│  Web UI          │
│  Server (Docker)   │RCON│  (backend)      │ WS │  (Next.js)       │
│  + Lua mod         │HTTP│  + Postgres     │    │                  │
└────────────────────┘    └─────────────────┘    └──────────────────┘
                                  │
                                  ▼
                          ┌─────────────────┐
                          │  Discord OAuth  │
                          │  (identity only)│
                          └─────────────────┘
```

Detailed architecture documents live in [`docs/`](docs/) — see
[`docs/deployment.md`](docs/deployment.md) for the operator runbook.

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
