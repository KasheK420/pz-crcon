# Architecture

> 🚧 This document is a placeholder. Full architecture will be written after the design brainstorming completes.

## Overview

`pz-crcon` will be a multi-component system:

```
┌──────────────┐  RCON   ┌─────────────┐   WS   ┌──────────────┐
│ PZ Server    │◀───────▶│  Backend    │◀──────▶│  Frontend    │
│ (+ Lua mod)  │ webhook │  API        │  REST  │  (Next.js?)  │
└──────────────┘────────▶└─────────────┘        └──────────────┘
                                │
                                ▼
                         ┌─────────────┐
                         │ PostgreSQL  │
                         └─────────────┘
```

## Components (planned)

| Component | Responsibility |
|-----------|---------------|
| **Backend API** | RCON client, auth (Discord OAuth), DB persistence, WebSocket pusher, Lua mod webhook endpoint |
| **Frontend** | Admin UI + public live map, real-time updates |
| **PZ Lua mod** | Server-side data collector (player positions, deaths, events) → backend webhook |
| **Database** | Players, bans, admin actions, logs, backups metadata |
| **Docker compose** | All-in-one deployment alongside the PZ server |

## Open Decisions

- [ ] Backend language/framework (Node.js / FastAPI / Go)
- [ ] Frontend framework (Next.js / SvelteKit)
- [ ] Database (Postgres vs SQLite)
- [ ] Auth model (Discord OAuth only vs magic link + Discord)
- [ ] Hosting target (HomePL alongside PZ vs. separate VPS)
- [ ] Real-time transport (WebSocket vs Server-Sent Events)

These will be locked down during the brainstorming + writing-plans phases.

## Related reading

- [Project Zomboid RCON commands (PZwiki)](https://pzwiki.net/wiki/Server_administration)
- [CRCON for Hell Let Loose](https://github.com/MarechJ/hll_rcon_tool) — architectural inspiration
- [Pterodactyl Panel](https://pterodactyl.io/) — another admin-panel reference
