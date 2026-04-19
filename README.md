# PZ-CRCON

> A modern, open-source web admin panel for **Project Zomboid** dedicated servers — with live world map, Discord OAuth, real-time monitoring, and a public-facing community page.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Project status: Alpha](https://img.shields.io/badge/status-alpha-orange.svg)](#status)
[![Project Zomboid: Build 42](https://img.shields.io/badge/PZ-Build%2042-green.svg)](https://projectzomboid.com)

---

## What is this?

`pz-crcon` is a self-hostable, Dockerized web admin panel for Project Zomboid (B41 + B42) dedicated servers. Inspired by [CRCON for Hell Let Loose](https://github.com/MarechJ/hll_rcon_tool), [Pterodactyl](https://pterodactyl.io/), and [AMP](https://cubecoders.com/AMP), but built **PZ-first** — no awkward Minecraft-flavored compromises.

It also ships with an optional **server-side Lua mod** that streams live player positions, deaths, chat, and world events out to the panel — enabling a public community map page, Discord notifications, and real analytics.

## Status

🚧 **Alpha — under active development.** No stable release yet. Architecture and feature set are being designed openly. See [project board](https://github.com/KasheK420/pz-crcon/projects) and [discussions](https://github.com/KasheK420/pz-crcon/discussions).

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
                          │  + bot          │
                          └─────────────────┘
```

Detailed architecture documents will live in [`docs/`](docs/).

## Quick Start

> ⚠️ Not yet usable. Watch the repo to be notified at v0.1.0.

When ready:

```bash
git clone https://github.com/KasheK420/pz-crcon.git
cd pz-crcon
cp .env.example .env
# fill in PZ RCON details, Discord OAuth, etc.
docker compose up -d
```

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
