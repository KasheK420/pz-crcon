# Architecture

> **Status:** reflects the code as of v0.2.0 / Phase 1.7. For what is still
> planned, see
> [`docs/superpowers/plans/2026-04-24-gap-analysis.md`](superpowers/plans/2026-04-24-gap-analysis.md).

## Summary

`pz-crcon` is a single Next.js 15 application (App Router + Server
Components + a custom `server/ws.ts` that attaches WebSocket handling to
the default Next HTTP server) running as a single container. It owns its
own process-level state (RCON connection, log streamer, lifecycle
orchestrator) and talks to four external surfaces:

1. **PZ dedicated server** — over RCON for commands, and (Phase 4) the
   companion Lua mod over an HMAC-signed webhook.
2. **Host Docker daemon** — read-only via `/var/run/docker.sock` for
   inspect, stats, logs. Mutating operations go through a
   [`tecnativa/docker-socket-proxy`](https://github.com/Tecnativa/docker-socket-proxy)
   sidecar with an explicit endpoint allowlist.
3. **Shared PostgreSQL** — over TCP, via Prisma.
4. **Discord OAuth** — identity only, via `next-auth@5`.

There is no separate backend service and no message broker. The
complexity budget is deliberately small; every future piece of work below
reuses the same container.

```
                   Cloudflare (DNS + Tunnel)
                              │
                              ▼
            ┌─────────────────────────────────┐
            │        nginx-proxy-manager      │
            └────────────────┬────────────────┘
                             │ proxy-net
                             ▼
 ┌───────────────────────────────────────────────────────┐
 │                     pz-crcon                          │
 │  Next 15 + custom ws server                           │
 │                                                       │
 │  app/                                                 │
 │   ├── (admin)   authed pages, role-gated              │
 │   ├── (public)  anonymous map / landing               │
 │   └── api/      REST routes (many CSRF-guarded)       │
 │                                                       │
 │  server/ws.ts   HTTP server + WS upgrade              │
 │                 installLogStreamer()                  │
 │                 (Phase 3) installWorker()             │
 │                                                       │
 │  lib/                                                 │
 │   ├── auth      next-auth 5 + DISCORD_ADMIN_IDS       │
 │   ├── csrf      double-submit vs next-auth cookie     │
 │   ├── docker    dockerode (sock RO) + TCP control     │
 │   ├── pz        parse/serialize/writer/validate/      │
 │   │             access-check/world-reset/snapshot     │
 │   ├── rcon      client + 45-command catalog           │
 │   ├── server    lifecycle orchestrator + audit        │
 │   └── ws        channels + server + log-streamer      │
 └──┬──────────┬───────────────┬─────────────────┬───────┘
    │          │               │                 │
    │ RCON     │ sock RO       │ TCP 2375        │ Postgres TCP
    │ (public) │ reads only    │ (allowlisted    │
    │          │               │  mutations)     │
    ▼          ▼               ▼                 ▼
┌──────────┐ ┌──────────────┐ ┌──────────────┐ ┌────────────────┐
│pz-server │ │ host Docker  │ │ docker-socket│ │ shared-postgres│
│ + shared │ │ daemon       │ │ -proxy       │ │ (Prisma 5)     │
│pz-data RW│ │              │ │ sidecar      │ │                │
└──────────┘ └──────────────┘ └──────────────┘ └────────────────┘
```

## Stack

| Layer | Choice | Notes |
| ----- | ------ | ----- |
| Language / runtime | **Node 22**, TypeScript 5.7, strict | Enforced in `package.json` `engines.node` |
| Framework | **Next.js 15** App Router + Server Components | Custom server at `server/ws.ts` so we can attach WS |
| Styling | **Tailwind 4** + `shadcn/ui` components (`@base-ui/react`) | `tw-animate-css` for micro-anims |
| DB | **PostgreSQL 16** via **Prisma 5** | Shared instance on HomePL, per-project DBs |
| Auth | **`next-auth` 5** with Discord provider | Static `DISCORD_ADMIN_IDS` allowlist, first = OWNER, rest = ADMIN |
| RCON | **`rcon-client` 4.2** | Singleton in `lib/rcon/client.ts`; catalog in `lib/rcon/commands.ts` |
| Docker | **`dockerode` 4** | Unix socket for reads; TCP against `docker-socket-proxy` for mutations |
| Realtime | **`ws` 8** for WebSocket | Channels in `lib/ws/channels.ts`. Phase 4 adds SSE for public positions |
| Logging | **`pino` 10** + `pino-pretty` in dev | Structured logs everywhere |
| Validation | **`zod` 4** | Every API route body + descriptor-driven config Zod |
| Concurrency | **`async-mutex` 0.5** | Per-file config mutex + lifecycle mutex |
| Tests | **`vitest` 2** | Unit + integration; no E2E yet |

## Deployment topology

```
HomePL VPS (85.215.222.81)
├── /opt/docker/pz-crcon/
│   ├── docker-compose.yml   (majorluk/pz-crcon + docker-socket-proxy)
│   └── .env
├── /opt/docker/projectzomboid/
│   └── pz-server container  (shared pz-data volume, uid 1000)
└── /opt/docker/infrastructure/
    ├── shared-postgres      (per-project DB "pzcrcon")
    ├── nginx-proxy-manager  (pz.majorluk.pl → pz-crcon:3000)
    └── cloudflared          (Cloudflare Tunnel)
```

- RCON talks to `85.215.222.81:27015`, not `127.0.0.1`, because the
  bridge container can't see host networking — see
  [ADR-0001](adr/0001-bridge-network-rcon.md).
- `pz-data` is bind-mounted **RW** into pz-crcon, with a one-off
  `chown -R 1000:1000` on the volume so the container user (uid 1000)
  can write config + rename save dirs for `reset-world`. See
  [`deployment.md`](deployment.md) §2.0.
- Watchtower polls DockerHub every 5 min for `majorluk/pz-crcon:latest`.

## Request anatomy

### An admin mutation (e.g. lifecycle restart)

```
Browser → /admin/config (Server Component fetches session)
       ↓
   clicks Restart button in ServerControlsCard
       ↓
   csrfFetch('/api/admin/server/restart', { method: 'POST' })
       ├─ next-auth csrf cookie → X-CSRF-Token header (double-submit)
       └─ session cookie stays on request
       ↓
   route.ts
       ├─ atLeast(role, "ADMIN")               → 403 otherwise
       ├─ checkCsrf(req)                        → 403 otherwise
       ├─ lifecycle.gracefulRestart()
       │     warning broadcast → save → quit → wait exited
       │     docker-socket-proxy stop (if still up) → start
       │     emits `server:lifecycle` phases over WS
       └─ recordAudit(userId, LIFECYCLE_RESTART, { detail })
       ↓
   WS `server:lifecycle` → LifecyclePhaseBadge updates live
   WS `rcon:output` → RconShell mirror of save/quit output
   /api/admin/server/state (polled by badge) shows new phase
```

### A read path (e.g. public map)

```
Browser → / (Server Component)
       ↓
   loadStatus() in app/(public)/page.tsx
       ├─ rconExecute("players")  (cached)
       ├─ parsePlayersOutput
       └─ prisma.mod.findMany({ where: { enabled: true } })
       ↓
   SSR HTML with ServerStatusCard + ModGrid
       ↓
   KnoxMapDynamic hydrates (client-only Leaflet)
       ↓
   Poll /api/players/positions every 2 s
       (Phase 4 switches to SSE /api/stream/positions)
```

## Security model

| Concern | Mitigation |
| ------- | ---------- |
| Who can log in | `DISCORD_ADMIN_IDS` allowlist checked in OAuth `signIn` callback; unknown IDs are rejected. No bot / guild membership check required. |
| Role rank | `OWNER` > `ADMIN` > `MODERATOR` > `VIEWER`. First allowlisted ID becomes OWNER on first login; the rest become ADMIN. |
| CSRF on mutations | `lib/csrf/check.ts` — compares `X-CSRF-Token` against the `__Host-next-auth.csrf-token` cookie family. Every config + lifecycle `POST/PUT` uses it. |
| Config writes | Atomic (tmp → fsync → rename), per-file mutex, keep a `.backups/.bak-<iso>` chain. Lifecycle mutex refuses writes while PZ is stopping / saving. |
| Secrets in config | Per-key `secret: true` in `lib/pz/ini-descriptors.ts`. Non-OWNER `GET /api/admin/config/ini` returns `"***"`. Only OWNER can hit `GET .../ini/secrets`. |
| Destructive ops | `reset-world` requires a typed `confirmPrefix` that must match the real server prefix. `force-stop` requires a literal `"FORCE-STOP"` confirmation and OWNER. |
| Docker daemon | Reads via `:ro` socket mount; all mutations through `tecnativa/docker-socket-proxy` with an allowlist limited to `CONTAINERS`, `POST`, `START`, `STOP`, `RESTART`, `KILL`. The app never gets `exec` or `images:write`. |
| WS auth | HTTP upgrade inspects session cookie (`lib/ws/auth.ts`). Per-channel `CHANNEL_MIN_ROLE`. Non-browser clients need an API token (Phase 3). |
| Audit trail | `AuditEvent` rows for every config write and lifecycle op, plus `AdminAction` rows for every RCON / player action. |
| RCON over public IP | Unavoidable with bridge networking; documented in [ADR-0001](adr/0001-bridge-network-rcon.md). PZ server binds RCON only on its public interface and UFW allows only port 27015 on that IP. |
| Phase 4 webhook | HMAC-SHA256 against `WEBHOOK_HMAC_SECRET` with a `_NEXT` rotation window. Body size-capped. |

## Data model (shipped)

| Model | Purpose |
| ----- | ------- |
| `User` | Admin/viewer row, `themePrefs`, relation to `AdminAction` / `ApiToken` |
| `Player` | Steam ID, name, flags (banned/whitelisted), positions (placeholder until Phase 4), perks, session stats |
| `Mod` | Workshop mod metadata (seeded by `scripts/sync-mods.ts`) |
| `AdminAction` | Per-action audit row (RCON exec, kick, ban, whitelist) |
| `AuditEvent` + `AuditKind` | Structured audit (config writes, lifecycle ops) |
| `PlayerEvent` | Reserved for Phase 4 |
| `Backup` + `BackupKind` | Reserved for Phase 3 |
| `Schedule` | Reserved for Phase 3 |
| `ApiToken` | Reserved for Phase 3 |

**Scheduled for removal** in Phase 2 (superseded / unused):
`SandboxOverride`, `ServerEvent`.

**Scheduled for addition** in Phase 4: `WorldEvent` (replaces the legacy
`ServerEvent` concept).

## Realtime channels

Defined in `lib/ws/channels.ts`, each has a `CHANNEL_MIN_ROLE`:

| Channel | Role | What it carries |
| ------- | ---- | --------------- |
| `events:public` | `null` | Reserved for future public pushes |
| `events:admin` | VIEWER | Admin-facing events (`AdminAction` inserts, lifecycle summaries, Phase 4 game events) |
| `players:positions` | VIEWER | Placeholder today — will stream position diffs once Phase 4 lands |
| `rcon:output` | MODERATOR | `{ user, command, output, ts }` for every RCON execution |
| `logs:server` | MODERATOR | Live tail of `docker logs pz-server` with ANSI stripped |
| `server:lifecycle` | VIEWER | `{ phase, detail, at }` — drives `LifecyclePhaseBadge` |

Heartbeat every `WS_HEARTBEAT_SEC` (default 30 s). Initial message on
connect: `{ type: "hello", role }`.

Phase 4 adds **SSE** at `/api/stream/positions` for one-way position
streaming, chosen over WS to play nice with Cloudflare Tunnel.

## Open decisions (future)

All Day-0 "open decisions" (language / framework / DB / auth model /
hosting / realtime transport) are closed. The remaining open items live
in upcoming ADRs:

- `0002-docker-socket-proxy.md` — why a proxy sidecar instead of
  mounting the raw socket **(planned in docs sweep)**
- `0003-auth-allowlist-vs-guild.md` — why the allowlist instead of the
  guild+bot model from the original spec **(planned in docs sweep)**
- `0004-sse-vs-ws-for-positions.md` — Phase 4 transport choice
  **(planned with Phase 4)**
- `0005-lua-hmac-scheme.md` — HMAC algorithm + rotation
  **(planned with Phase 4)**

## Related reading

- [Operator runbook](deployment.md)
- [ADR-0001 — Bridge network + RCON over public IP](adr/0001-bridge-network-rcon.md)
- [Phase 1 MVP plan](superpowers/plans/2026-04-20-phase1-mvp.md)
- [Phase 1.7 plan (config editor + lifecycle)](superpowers/plans/2026-04-20-phase1.7-config-editor-lifecycle.md)
- [Gap analysis + forward plans](superpowers/plans/2026-04-24-gap-analysis.md)
- [Project Zomboid RCON commands (PZwiki)](https://pzwiki.net/wiki/Server_administration)
- [CRCON for Hell Let Loose](https://github.com/MarechJ/hll_rcon_tool) — architectural inspiration
- [Pterodactyl Panel](https://pterodactyl.io/) — another admin-panel reference
