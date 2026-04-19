# PZ-CRCON v0.1 — Design Specification

**Status:** Approved (brainstorming → spec)
**Date:** 2026-04-20
**Author:** Lukas Majoros (@KasheK420) with Claude Opus 4.7
**Repo:** https://github.com/KasheK420/pz-crcon
**Public URL (planned):** https://pz.majorluk.pl

---

## 1. Goals

Build a self-hostable, OSS web admin panel for Project Zomboid B42 dedicated servers. Replace the current `itzg/rcon` workaround with a polished, PZ-native experience. Ship with:

- **Admin panel** (Discord OAuth gated) — full server management
- **Public live map** (anonymous) — community-facing showcase
- **Companion Lua mod** (server-side) — pushes live world data to the panel

### Non-goals (v0.1)

- Multi-server / multi-instance management (single PZ server only)
- Mobile-native apps (responsive web only)
- Email notifications (Discord only)
- E-commerce / paid tiers
- Whitelist auto-sync from Steam Web API (manual UI only)

---

## 2. Architecture overview

```
Internet ──[Cloudflare Tunnel]──▶ NPM (proxy) ──▶ pz-crcon container (Next.js + WS)
                                                          │
                                                          ├── PostgreSQL (shared-postgres on HomePL)
                                                          ├── Discord OAuth + Bot
                                                          │
                                                          ▼ TCP/RCON 27015
                                                   pz-server container (host network)
                                                          ▲
                                                   HTTP webhook (HMAC) ◀── PZ Lua mod (server-side)
```

All components run on the **HomePL VPS**. PZ server already exists at `/opt/docker/projectzomboid/`. The `pz-crcon` stack is deployed alongside it as a separate compose project sharing the `db-net` Docker network.

---

## 3. Tech stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Runtime | Node.js 22 LTS | Match design (React); single-language stack reduces ops complexity |
| Frontend framework | Next.js 15 (App Router) + React 18 | Matches existing user repos (PersonalBanking, majorluk-web). RSC where possible. |
| Language | TypeScript 5 (strict mode) | Type safety end-to-end |
| Styling | TailwindCSS 4 + shadcn/ui (themed) | Match design's design-token approach; rapid iteration |
| Backend API | Next.js Route Handlers (`app/api/`) | Co-located, single deploy, simpler ops |
| Real-time | Native `ws` server in same Node process, mounted at `/api/ws` | Low overhead, no third-party SaaS |
| ORM | Prisma 5 | Match PersonalBanking; great DX; migrations |
| Database | PostgreSQL 16 (shared-postgres on HomePL) | Existing infra |
| Auth | Auth.js v5 (NextAuth) + Discord provider + JWT sessions | Game communities live on Discord |
| RCON client | `rcon-client` (npm) | Stable, maintained Source RCON impl |
| PZ mod | Pure Lua, single-file, B42-compatible | Minimum invasive |
| Validation | Zod | Type-safe parsing of RCON output, webhook payloads, env vars |
| Logging | Pino (structured) | Standard Node logger |
| Testing | Vitest (unit/integration) + Playwright (E2E) | Modern, fast |
| CI/CD | GitHub Actions → DockerHub (`majorluk/pz-crcon`) → Watchtower (5min poll) | Match existing infra pattern |
| Container | Docker, Alpine-based Node image | Match existing infra |

---

## 4. Repository layout

```
pz-crcon/
├── app/                          # Next.js App Router
│   ├── (public)/
│   │   ├── page.tsx              # Public live map landing
│   │   └── layout.tsx
│   ├── (admin)/
│   │   ├── layout.tsx            # Auth-gate; sidebar shell
│   │   ├── page.tsx              # /admin overview
│   │   ├── rcon/page.tsx
│   │   ├── players/page.tsx
│   │   ├── config/page.tsx
│   │   ├── mods/page.tsx
│   │   ├── logs/page.tsx
│   │   ├── backups/page.tsx
│   │   ├── schedules/page.tsx
│   │   └── settings/page.tsx
│   ├── api/
│   │   ├── auth/                 # Auth.js routes
│   │   ├── rcon/                 # POST execute command
│   │   ├── players/              # CRUD + actions (kick/ban)
│   │   ├── config/               # GET/PATCH sandbox + ini
│   │   ├── mods/                 # GET, POST add, DELETE, PATCH order
│   │   ├── logs/                 # GET (filterable, paginated)
│   │   ├── backups/              # GET, POST create, POST restore
│   │   ├── schedules/            # CRUD
│   │   ├── webhook/mod/          # POST from Lua mod (HMAC)
│   │   └── ws/                   # WebSocket upgrade handler
│   └── layout.tsx
├── components/
│   ├── ui/                       # shadcn primitives
│   ├── shell/                    # Sidebar, Topbar
│   ├── map/                      # Tactical map (canvas/SVG)
│   ├── rcon/                     # Terminal, command palette
│   └── ...                       # Per-page components
├── lib/
│   ├── rcon/                     # Source RCON client wrapper, command parsers
│   ├── auth/                     # Auth.js config + Discord role check
│   ├── db/                       # Prisma client + helpers
│   ├── ws/                       # WS server bootstrap, channel registry
│   ├── pz/                       # PZ-specific: sandbox vars schema, log parsers
│   └── env.ts                    # Zod-validated env vars
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── lua-mod/                      # Server-side PZ mod
│   ├── mod.info
│   ├── poster.png
│   └── media/lua/server/PZCrcon/
│       ├── Init.lua
│       ├── Webhook.lua
│       └── Collectors/
│           ├── Players.lua
│           ├── Events.lua
│           └── Chat.lua
├── docker/
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── docker-compose.deploy.yml
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── docs/
│   ├── superpowers/specs/
│   ├── architecture.md
│   ├── adr/                      # Architecture Decision Records
│   ├── deployment.md
│   ├── lua-mod-protocol.md
│   └── api.md
├── scripts/                      # dev/migrate/deploy helpers
├── .github/                      # workflows + templates (already exists)
└── (existing OSS files)
```

---

## 5. Data model (Prisma schema, abridged)

```prisma
model User {
  id            String   @id @default(cuid())
  discordId     String   @unique
  username      String
  avatar        String?
  role          UserRole @default(VIEWER)
  themePrefs    Json?    // tweaks panel state (B option)
  createdAt     DateTime @default(now())
  lastLogin     DateTime?
  apiTokens     ApiToken[]
  adminActions  AdminAction[]
}

enum UserRole {
  OWNER MODERATOR ADMIN VIEWER
}

model Player {
  id            String   @id @default(cuid())
  steamId       String   @unique
  name          String
  firstSeen     DateTime @default(now())
  lastSeen      DateTime @default(now())
  totalPlaytime Int      @default(0) // seconds
  deaths        Int      @default(0)
  isWhitelisted Boolean  @default(false)
  isBanned      Boolean  @default(false)
  banReason     String?
  banExpiresAt  DateTime?
  banByUserId   String?
  ipLastSeen    String?
  countryLast   String?
  notes         String?
  // live data (last known, refreshed by mod)
  lastX         Float?
  lastY         Float?
  lastZ         Float?
  lastRegion    String?
  lastHealth    Float?
  lastHunger    Float?
  lastFatigue   Float?
  isOnline      Boolean  @default(false)
  inGameDay     Int?
  perks         Json?
  events        PlayerEvent[]
}

model PlayerEvent {
  id        String   @id @default(cuid())
  playerId  String
  player    Player   @relation(fields: [playerId], references: [id])
  kind      String   // join | leave | death | chat | admin | ...
  payload   Json
  occurredAt DateTime @default(now())
  @@index([playerId, occurredAt])
}

model Mod {
  id              String   @id @default(cuid())
  workshopId      String   @unique
  modId           String   // internal mod id from mod.info
  name            String
  thumbnailUrl    String?
  version         String?
  enabled         Boolean  @default(true)
  loadOrder       Int
  size            BigInt?
  installedAt     DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

model Backup {
  id          String   @id @default(cuid())
  filename    String   @unique
  sizeBytes   BigInt
  kind        BackupKind
  modCount    Int?
  createdAt   DateTime @default(now())
  createdById String?
  notes       String?
}

enum BackupKind { AUTO MANUAL PRE_RESTART PRE_MOD_UPDATE }

model AdminAction {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  kind      String   // rcon_exec | kick | ban | restart | ...
  target    String?  // player name, command, etc.
  details   Json
  createdAt DateTime @default(now())
  @@index([createdAt])
}

model Schedule {
  id          String   @id @default(cuid())
  name        String
  cronExpr    String
  kind        String   // restart | broadcast | event | backup
  payload     Json
  enabled     Boolean  @default(true)
  lastRunAt   DateTime?
  nextRunAt   DateTime?
}

model ApiToken {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  name      String
  prefix    String   @unique
  hash      String
  scopes    String[] // e.g. ["webhook:mod", "rcon:read"]
  createdAt DateTime @default(now())
  lastUsedAt DateTime?
  expiresAt DateTime?
}

model SandboxOverride {
  id        String   @id @default(cuid())
  key       String   @unique
  value     Json
  setByUserId String?
  setAt     DateTime @default(now())
  appliedAt DateTime?
}

model ServerEvent {
  id        String   @id @default(cuid())
  kind      String   // helicopter | weather | save | ...
  payload   Json
  occurredAt DateTime @default(now())
  @@index([kind, occurredAt])
}
```

---

## 6. API surface (selected highlights)

### REST (Next.js Route Handlers)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/status` | public (cached 10s) | Server status for public map |
| GET | `/api/players/online` | public (cached 10s) | Anonymized player positions for public map |
| POST | `/api/auth/[…]` | varies | Auth.js endpoints |
| GET | `/api/players` | admin | List with filters |
| POST | `/api/players/:id/kick` | mod+ | Kick via RCON |
| POST | `/api/players/:id/ban` | admin+ | Ban with reason |
| POST | `/api/rcon/execute` | mod+ | Execute RCON command (audit logged) |
| GET | `/api/config/sandbox` | admin | Current sandbox vars |
| PATCH | `/api/config/sandbox` | admin | Stage changes (apply on next restart) |
| GET | `/api/mods` | admin | List installed mods |
| POST | `/api/mods` | admin | Add by Workshop URL/ID |
| GET | `/api/logs` | admin | Filterable log query |
| POST | `/api/backups` | admin | Trigger manual backup |
| POST | `/api/backups/:id/restore` | owner | Restore (double-confirm) |
| POST | `/api/webhook/mod` | HMAC | Lua mod data ingestion |

### WebSocket (`/api/ws`)

Channels (subscribed on auth):
- `events:public` — public-safe events (server status, anonymized join/leave)
- `events:admin` — full event stream (chat, deaths, admin actions, errors)
- `players:positions` — live coords (admin: full; public: anonymized)
- `rcon:output` — streamed RCON command output (admin only)

Message envelope:
```json
{ "channel": "events:admin", "type": "death", "data": {...}, "ts": 1776637200000 }
```

---

## 7. Lua mod protocol

The companion mod runs server-side on the PZ dedicated server. It collects events and posts them to `pz-crcon` via HTTP.

### Configuration

Mod reads config from `Zomboid/Server/PZCrcon.cfg`:

```
endpoint=https://pz.majorluk.pl/api/webhook/mod
token=<HMAC_SECRET_FROM_ENV>
heartbeat_seconds=10
batch_max=50
```

### Auth

Each request includes:
- `X-PZCrcon-Timestamp: <unix>`
- `X-PZCrcon-Signature: hex(HMAC_SHA256(secret, timestamp + "." + body))`

Server rejects requests:
- Older than 60 seconds
- With invalid HMAC
- With duplicate timestamp+nonce (replay protection)

### Payload shape

```json
{
  "v": 1,
  "heartbeat": { "uptimeSec": 12345, "tps": 59.7, "playersOnline": 3 },
  "events": [
    { "t": 1776637200, "kind": "join",   "player": "Honza", "steamId": "76561...", "ip": "84.42.x.x" },
    { "t": 1776637205, "kind": "death",  "player": "Honza", "cause": "zombie", "loc": [x,y,z], "day": 47 },
    { "t": 1776637210, "kind": "chat",   "player": "Petr",  "msg": "anybody got nails?" },
    { "t": 1776637215, "kind": "pos",    "player": "Honza", "loc": [x,y,z], "region": "West Point", "health": 0.78 },
    { "t": 1776637220, "kind": "helicopter", "target": "Honza" }
  ]
}
```

### Detailed per-event schema documented in `docs/lua-mod-protocol.md`.

---

## 8. Auth model

- **Public surface** (`/`) — no auth
- **Admin surface** (`/admin/*`) — Discord OAuth required, plus user must:
  - Be in the configured Discord guild (`DISCORD_GUILD_ID`), AND
  - Hold the configured admin role (`DISCORD_ADMIN_ROLE_ID`)

### Roles

Roles are stored in DB after first login:
- **OWNER** — all permissions, only one (initial bootstrap user)
- **ADMIN** — everything except billing/destructive infra
- **MODERATOR** — kick, ban, broadcast, RCON read; no config changes
- **VIEWER** — read-only dashboards, no actions

Role assignment: OWNER promotes via Settings page.

### Sessions

- JWT, 24h sliding window
- Stored in HTTP-only secure cookie
- WebSocket auth: client sends initial `auth` frame with session token, server validates against in-memory cache (refreshed from DB on miss)

### Tweaks panel (option B)

User theme preferences (`accent`, `grain`, `scanlines`, `intensity`, `startPage`) saved to `User.themePrefs` JSON, applied via `applyTweaks()` on every page load.

---

## 9. Deployment

### Local development

```bash
git clone https://github.com/KasheK420/pz-crcon.git
cd pz-crcon
cp .env.example .env  # fill in
docker compose -f docker/docker-compose.yml up -d  # local Postgres + app
pnpm install
pnpm prisma migrate dev
pnpm dev
```

### Production (HomePL)

`/opt/docker/pz-crcon/`:
- `docker-compose.yml` (one service: `pz-crcon`, image from DockerHub)
- `.env` (with real secrets)
- Joins existing `proxy-net` and `db-net` networks

NPM proxy host:
- Domain: `pz.majorluk.pl`
- Forward: `pz-crcon:3000`
- Cloudflare Tunnel handles TLS

DNS: CNAME `pz.majorluk.pl` → existing HomePL Cloudflare Tunnel hostname

DB:
- Database `pzcrcon` on shared-postgres
- User `pzcrcon_user` with isolated permissions

GitHub Actions workflow `release.yml`:
- On push to `main`: build Docker image, push to `majorluk/pz-crcon:latest` and `:<sha>`
- Watchtower picks it up within 5 minutes on HomePL

---

## 10. Phasing (delivery roadmap)

### Phase 1 — MVP (target: 1 week)
**Goal:** Replace `itzg/rcon` for daily ops.

- [ ] Next.js scaffold + Tailwind + shadcn/ui themed for design
- [ ] Auth.js + Discord OAuth + role gate
- [ ] Prisma schema + migrations + seed
- [ ] Docker dev environment
- [ ] Sidebar/Topbar shell from design
- [ ] **Public Map** — mock data, server status widget, mod list (read from DB)
- [ ] **Admin Overview** — read-only dashboard, status cards, online players list (from RCON)
- [ ] **RCON Terminal** — live command execution, history, autocomplete, output streaming over WS
- [ ] **Players** — table view, kick/ban via RCON, audit logging
- [ ] CI: lint, typecheck, unit tests, build
- [ ] Deploy to HomePL, accessible at `pz.majorluk.pl`

### Phase 2 — Operator suite (target: 1 week)
- [ ] **Config editor** — sandbox vars (visual sliders), server.ini, diff + apply-on-restart
- [ ] **Mods** — list from PZ filesystem, enable/disable, add by Workshop URL, conflict detection
- [ ] **Logs viewer** — tail multiple log files, filters, search, export

### Phase 3 — Operations & schedules (target: 1 week)
- [ ] **Backups** — manual + cron, restore with double-confirm
- [ ] **Schedules** — restarts with broadcast warnings, recurring events
- [ ] **Settings** — Discord config, notification rules, user role mgmt, API tokens

### Phase 4 — Live data + Lua mod (target: 1 week)
- [ ] PZ Lua mod scaffold + Workshop publish
- [ ] HMAC webhook ingestion endpoint
- [ ] Live player positions on public map
- [ ] Live event feed (deaths, joins, helicopter) on public map
- [ ] Discord notifications (configurable per event type)

---

## 11. Testing strategy

| Layer | Tooling | What we test |
|-------|---------|--------------|
| Unit | Vitest | RCON parsers, sandbox var validators, HMAC helpers, log parsers |
| Component | Vitest + Testing Library | Sidebar, Topbar, RCON terminal, sliders |
| Integration | Vitest + Prisma test DB | API route handlers with real Postgres |
| E2E | Playwright | Login flow, RCON command execution, player ban flow |
| Manual | Local PZ test server | Full smoke before deploy |

CI runs: lint → typecheck → unit → component → integration on every PR. E2E runs nightly + on release tag.

---

## 12. Security posture

- All secrets via env vars (never committed); `.env.example` template only
- Gitleaks scan in CI on every PR (already configured)
- Secret scanning + push protection enabled on GitHub repo
- HMAC for Lua mod webhook (timestamp + nonce replay protection)
- CSRF protection (Next.js native + Auth.js)
- All admin actions audit-logged to `AdminAction` table
- Database user isolated (no superuser)
- Container runs as non-root user
- No public RCON port exposure (RCON stays loopback/host network)
- Rate limiting on public endpoints (mod data scraping deterrent)
- Trivy + CodeQL scans on every PR (already configured)
- Private vulnerability reporting enabled (SECURITY.md)

---

## 13. Open questions / risks

| Topic | Risk | Mitigation |
|-------|------|------------|
| PZ Lua mod API stability | Indie Stone may break things across B42 patches | Pin to specific build, test on B42.16+, version mod independently |
| WS scaling | Single-process WS might bottleneck if hundreds connect | Acceptable for v0.1 (target 6-20 users); revisit if Phase 4 sees public map go viral |
| `network_mode: host` for RCON | Already established pattern; pz-crcon needs same | pz-crcon container also uses host network OR uses public IP `85.215.222.81` |
| Discord OAuth dependency | If Discord is down, no admin can log in | Add bootstrap recovery: Owner can use API token from CLI |
| Backup storage | 2-3 GB per snapshot × 14 days = ~40 GB | Disk monitoring; configurable retention; off-site sync optional |
| Workshop collection deletion (already happened) | Already mitigated — server installs by ID, not collection |  |

---

## 14. Decisions made (vs. discarded alternatives)

- **Next.js full-stack vs. split FE/BE** → Full-stack chosen for ops simplicity (1 container, 1 deploy)
- **WebSocket vs. SSE** → WS chosen because we also need *bi-directional* RCON command streaming
- **Tailscale-only admin vs. public Discord-OAuth** → Public OAuth — friends won't always have Tailscale; OAuth + role gate is sufficient
- **Single repo vs. monorepo with workspaces** → Single flat repo for v0.1; refactor to monorepo if `lua-mod` and `web` end up on different release cadences
- **Polling vs. push for player positions** → Push from Lua mod (lower latency, less polling load)
- **shadcn/ui themed vs. custom from scratch** → shadcn/ui for accessibility primitives, heavy theming for the post-apo aesthetic
- **Tweaks panel: keep / dev only / drop** → Keep, persisted per-user (option B)

---

## 15. Acceptance criteria (Phase 1 MVP)

The MVP is "done" when:

1. Owner can log in via Discord at `pz.majorluk.pl`
2. Owner sees Admin Overview with current server status
3. Owner can execute any RCON command via the web terminal and see streamed output
4. Owner can view full player list and kick/ban any player via UI (action audit logged)
5. Public map page is reachable anonymously, shows server status + mod list
6. App runs on HomePL via Docker, auto-updates via Watchtower
7. CI passes (lint + typecheck + unit + integration)
8. Wiki has install + setup docs
9. README updated with screenshots and current status

---

## 16. Next steps

1. ✅ This spec written and committed
2. → Spec review by reviewer subagent (max 5 iterations)
3. → User reviews and approves
4. → Invoke `superpowers:writing-plans` skill for detailed Phase 1 plan
5. → Implement Phase 1 in TDD-style increments per executing-plans skill
