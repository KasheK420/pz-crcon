# PZ-CRCON — Config Editor, Server Controls & Log Viewer Fix

**Phase:** 1.7
**Date:** 2026-04-20
**Status:** Review → Revised (v2, addresses spec-review blockers)
**Replaces/Extends:** Phase 1.6 (read-only config viewer, admin tools)

## Problem

The Phase 1.6 admin panel ships a **read-only** view of `MajorlukPZ.ini` and `MajorlukPZ_SandboxVars.lua` and no way to control the container. The only tools today are SSH + vim and `docker compose restart`. Three concrete gaps:

1. **Config editor** — users must SSH to edit zombie speed, XP multipliers, loot, whitelist, etc. The existing descriptor/parser layer is half of the work; the write path and UI are missing.
2. **Server lifecycle** — no way to start/stop/restart `pz-server` from the panel. Config edits are useless without an accompanying restart flow because PZ only reads these files at boot.
3. **Log viewer is broken** — `/admin/logs` renders the `LogViewer` component but no lines ever arrive. Root cause: the production compose on HomePL doesn't mount `/var/run/docker.sock` into pz-crcon, so `tailContainerLogs()` returns `null`.

Success criteria:

- Any descriptor-covered value in `servertest.ini` / `servertest_SandboxVars.lua` is editable in the web UI with typed controls (switch / slider / select / input) and a hint tooltip.
- Save flow writes the file atomically with a `.bak-<ts>` backup, prompts for restart, and streams lifecycle phase via WS so the user sees what's happening.
- Admins have four lifecycle buttons (Start / Stop / Restart / Force stop) with a graceful RCON-first flow for the first three.
- `/admin/logs` shows live `docker logs -f pz-server` output after deploy.
- No more SSH for routine server admin.

Non-goals (explicit YAGNI):

- Scheduled auto-restart (host cron suffices).
- In-game live tuning via `changeoption` for values that are applicable (can be added later; MVP always restarts on save).
- Editing `MajorlukPZ_spawnregions.lua` / `spawnpoints.lua` (these change rarely; SSH is fine).
- Diffable history beyond the on-disk `.bak-<ts>` chain (no git-of-configs).

## Architecture

### Infrastructure (HomePL)

Four compose changes to `/opt/docker/pz-crcon/docker-compose.yml`:

1. **Bind-mount `pz-data` volume into pz-crcon** at `/pz-data`. Same named volume already owned by `pz-server`. Config files land at `/pz-data/Server/<prefix>.{ini,lua}`. Chunk 1 lands this **read-only** (reader-switch + logs fix); Chunk 3 flips to `:rw` when the writer is ready — minimizes how long the write surface is exposed.
2. **Mount `/var/run/docker.sock:ro`** into pz-crcon for logs tailing, container stats, and env/inspect lookups. Already wired through `lib/docker/client.ts` but never reached production.
3. **Add `tecnativa/docker-socket-proxy`** sidecar on an isolated `pz-control-net` network, reachable only from pz-crcon. The only route for mutating operations. Explicit env flag matrix (verified against `tecnativa/docker-socket-proxy` `haproxy.cfg` allowlists — the per-endpoint booleans are required; `POST=1` alone is insufficient):

   | Flag | Value | Unblocks (under `/containers/<id>/*`) |
   |---|---|---|
   | `CONTAINERS=1` | 1 | GET `json`, `stats`, `logs`, `top` |
   | `POST=1` | 1 | Enables POST verb globally |
   | `CONTAINERS_START=1` | 1 | POST `start` |
   | `CONTAINERS_STOP=1` | 1 | POST `stop` (honors `?t=<s>`) |
   | `CONTAINERS_RESTART=1` | 1 | POST `restart` |
   | `CONTAINERS_KILL=1` | 1 | POST `kill` (force-stop) |
   | `EXEC=0` | 0 | Explicit deny |
   | `VOLUMES=0 NETWORKS=0 IMAGES=0 SYSTEM=0 INFO=0` | 0 | Belt-and-braces deny |

   Smoke check: `curl -sw '%{http_code}' http://docker-socket-proxy:2375/_ping` returns 200 from inside pz-crcon, times out elsewhere.

4. **UID/GID alignment.** `renegademaster/zomboid-dedicated-server` runs as `steam` (UID/GID 1000). Pz-crcon's node image runs as `node` (UID 1000) or `nextjs` (UID 1001) depending on base. Pin pz-crcon to `user: "1000:1000"` in compose. At boot, `lib/pz/access-check.ts` runs `fs.access(PZ_CONFIG_DIR, R_OK | W_OK)`; failure logs WARN, flips a global `configAccessOk` flag, and PUT routes return 503 `{ code: 'config-dir-unreachable' }` until next restart re-checks. `GET /api/admin/config/access` surfaces the flag so the UI can show a red banner before the user attempts to save. Mitigates cross-container permission collisions.

```yaml
# excerpt
services:
  pz-crcon:
    user: "1000:1000"                         # match pz-server's steam UID
    volumes:
      - pz-data:/pz-data:ro                   # Chunk 1; flips to :rw in Chunk 3
      - /var/run/docker.sock:/var/run/docker.sock:ro
    environment:
      PZ_CONFIG_DIR: /pz-data/Server
      PZ_SERVER_DIR: /pz-data/Server          # existing var, re-pointed
      DOCKER_CONTROL_URL: http://docker-socket-proxy:2375
      PZ_CONTAINER_NAME: pz-server
      PZ_BACKUP_DIR: /pz-data/Server/.backups
    networks:
      - proxy-net
      - db-net
      - pz-control-net

  docker-socket-proxy:
    image: tecnativa/docker-socket-proxy:latest
    container_name: pz-crcon-socket-proxy
    read_only: true
    environment:
      CONTAINERS: 1
      POST: 1
      CONTAINERS_START: 1
      CONTAINERS_STOP: 1
      CONTAINERS_RESTART: 1
      CONTAINERS_KILL: 1
      EXEC: 0
      VOLUMES: 0
      NETWORKS: 0
      IMAGES: 0
      SYSTEM: 0
      INFO: 0
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    networks:
      - pz-control-net
    restart: unless-stopped

volumes:
  pz-data:
    external: true

networks:
  pz-control-net: {}                          # not shared
```

The `pz-data` volume is defined by pz-server compose under `name: pz-data`, so `external: true` picks it up without duplication.

### Module layout

**New modules:**

| Path | Responsibility |
|---|---|
| `lib/pz/writer.ts` | `writeServerIni(patch, opts)`, `writeSandboxVars(patch, opts)` — atomic file write (write tmp → fsync → rename), `.bak-<iso>` backup **in `/pz-data/Server/.backups/`** (sibling directory — keeps PZ's file listing clean and prevents the game from treating a `.bak` as a valid config), retention of last 10 backups per file, mtime-based optimistic locking, and a process-level **mutex** (`async-mutex`): writes reject with 409 `code: 'config-busy'` if another write is in flight or if `lib/server/lifecycle.ts` holds the lifecycle lock. Writes are further gated to only proceed when lifecycle phase is `idle` (otherwise 409 `code: 'lifecycle-busy'`) — eliminates races with pz-server rewriting the file during `quit` flush. |
| `lib/pz/ini-descriptors.ts` (extend) | Grow to full coverage of every documented server.ini key; add `type`, `enum`, `min`, `max`, `step`, `default` fields |
| `lib/pz/sandbox-descriptors.ts` (new) | Curated metadata for every sandbox var (~130 entries) — `{ path, label, type, min, max, step, options, help, section, default }` |
| `lib/pz/validate.ts` | `validateIniPatch(patch, descriptors)`, `validateSandboxPatch(patch, descriptors)` returning Zod results; rejects unknown keys and out-of-range values |
| `lib/pz/serialize-ini.ts` | **Line-based rewriter.** PZ ini files are simple `Key=Value` one-per-line; regex `^(\s*)<Key>(\s*)=(\s*)(.*?)(\s*)$` per-key captures indentation, surrounding whitespace, and preserves the rest of the line (trailing comments after a `#` we leave intact). Unknown keys and non-matching lines (blank, comment-only) are passed through verbatim. Trailing newline and EOL style (`\r\n` vs `\n`) preserved by detecting from the first line break in the source. |
| `lib/pz/serialize-sandbox-lua.ts` | **Line-based rewriter, constrained.** Extend `parse-sandbox-lua.ts` to optionally emit **source offsets** per `{ path, rawValueStart, rawValueEnd }` during parse; the serializer replaces just the value slice per target key while keeping all comments, commas, indentation, and blank lines intact. Assumption: one `Key = scalar,` per line in canonical PZ output. A parser validation pass at boot asserts this on the fixture, and serializer **refuses to write** if any target key's path was not captured with source offsets (falls back with a `code: 'serialize-shape-unsupported'` error visible in UI). This bounds behaviour instead of best-effort-guessing. Round-trip fuzz test (parse → serialize → parse) covers the shipped `servertest_SandboxVars.lua` seed + the live `MajorlukPZ_SandboxVars.lua` copy as fixtures. |
| `lib/docker/control.ts` | **Separate dockerode instance** configured with `{ host: 'docker-socket-proxy', port: 2375, protocol: 'http' }` (distinct from the `socketPath`-based read client in `lib/docker/client.ts`). Exports `startPz()`, `stopPz(timeoutS)`, `restartPz(timeoutS)`, `killPz()`, `inspectPz()`, `waitForState(name, want, timeoutMs)`. Also exports `isProxyReachable(): Promise<boolean>` used by `/api/admin/server/state` to populate a `proxyReachable` field so the UI can distinguish "proxy down" from "container down". |
| `lib/rcon/commands.ts` (extend) | Add `servermsg(text)`, `save()`, `quit()`, `reloadoptions()` helpers |
| `lib/server/lifecycle.ts` | Orchestrates graceful flows: `gracefulRestart(warningSeconds)`, `gracefulStop(warningSeconds)`. Uses RCON for in-game warning + save, then Docker. Emits WS events per phase. **Exclusive lock** (`async-mutex`) — concurrent lifecycle API calls from different admins reject with 409 `code: 'lifecycle-busy'`. Also exports the lock to the writer so saves are blocked during shutdown flushes. |
| `lib/ws/channels.ts` (extend) | Add `server:lifecycle` channel with phase payload `{ phase: 'idle'|'warning'|'saving'|'stopping'|'starting', at, detail? }` |

**Modified modules:**

| Path | Change |
|---|---|
| `lib/pz/config-reader.ts` | Primary path: `fs.readFile(PZ_CONFIG_DIR/<prefix>.ini)`. No automatic fallback — if the bind-mount isn't present (dev without docker), the reader returns `{ ok: false, error: 'PZ_CONFIG_DIR unreachable' }` and the UI shows the access banner. Local dev uses a `.env.local` override `PZ_CONFIG_DIR=./tmp/pz-fixture/Server` pointing at a copied fixture — simpler than keeping two code paths. `detectServerPrefix()` is still socket-dependent (reads `SERVERNAME` env from container inspect); adds env override `PZ_SERVER_PREFIX` for the case where the socket is unavailable (falls through to "servertest"/hardcoded). |
| `app/(admin)/admin/config/page.tsx` | Drop the read-only banner. Pass descriptors to the tabs. |
| `components/config/config-tabs.tsx` | Wrap children with an edit-buffer context; each tab gets a Save button and wires into the save flow |
| `app/(admin)/admin/page.tsx` | Add `<ServerControlsCard />` to the dashboard. |
| `lib/ws/server.ts` | Ensure `installLogStreamer()` is called at WS server boot (if not already). |

**New API routes:**

| Method | Path | Role | Returns |
|---|---|---|---|
| `GET` | `/api/admin/config/ini` | VIEWER | `{ ok, path, mtime, entries: [...], descriptors: [...] }` |
| `PUT` | `/api/admin/config/ini` | OWNER | `{ ok, diff: [...], newMtime }` or `{ ok: false, code: 'mtime-race'\|'validation'\|'io', detail }` |
| `GET` | `/api/admin/config/sandbox` | VIEWER | `{ ok, path, mtime, sections: [...], descriptors: [...] }` |
| `PUT` | `/api/admin/config/sandbox` | OWNER | same shape as ini |
| `POST` | `/api/admin/server/start` | ADMIN | `{ ok }` |
| `POST` | `/api/admin/server/stop` | ADMIN | `{ ok }` (graceful; body `{ immediate: true }` requires OWNER and skips RCON ceremony) |
| `POST` | `/api/admin/server/restart` | ADMIN | `{ ok }` |
| `POST` | `/api/admin/server/force-stop` | OWNER | `{ ok }` (direct docker stop, bypass RCON) |
| `GET` | `/api/admin/server/state` | VIEWER | `{ containerState, rconOnline, lifecyclePhase, players, uptime }` |

### Editor UI (`/admin/config`)

Existing `ConfigTabs` already has Ini and Sandbox tabs. Refactor:

1. Every row gets typed control:
   - **bool** → shadcn `Switch`
   - **enum** → shadcn `Select` with descriptor `options` providing `{ value, label, help? }`
   - **int** / **float** with bounded range → `Slider` + numeric `Input` combo (slider for common ranges, input for precision)
   - **int** / **float** unbounded → `Input` type=number
   - **string** → `Input` (multi-line for known-long fields via `textarea` flag)
2. Hint tooltip from descriptor `help` + external wiki link
3. Changed rows highlighted; per-section `Save changes` button enabled when dirty
4. On click: **DiffModal** lists `{ key, from, to }`. Confirm → PUT → toast → **RestartPromptModal** (if any changed descriptor has `requiresRestart: true`, default yes).
5. Restart modal buttons: `Restart now` (ADMIN+; disabled otherwise), `Later`, `Copy RCON command` (for users who want to live-tweak via `changeoption` where the game supports it — future hook).

### Server controls UI

`components/server/server-controls-card.tsx` on `/admin`:

- Status badge driven by WS `server:lifecycle` + `/api/admin/server/state`
- Four buttons (Start, Stop, Restart, Force stop). Disabled based on current phase.
- During graceful shutdown: inline 30-second countdown + "Players notified" status line.
- All actions emit a toast + log line into the WS `admin:events` channel so audit is visible in the activity sidebar.

### Data flow

```
Edit form (client)
    ↓ user edits N fields
    ↓ clicks Save
PUT /api/admin/config/sandbox { mtime, patch: { "Zombies.Speed": 2, "Loot.FoodLootNew": 0.5 } }
    ↓ route
    1. require OWNER
    2. fs.stat(file) → if mtime !== client mtime → 409 mtime-race
    3. read raw
    4. parse with parseSandboxLua → current values
    5. validateSandboxPatch(patch, SANDBOX_DESCRIPTORS) (Zod)
    6. serialize: walk raw line-by-line, replace scalar values for keys in patch
    7. backup: fs.copyFile(file, file + '.bak-' + iso); prune to 10 newest
    8. write: fs.writeFile(tmp, newRaw) → fs.fsync → fs.rename(tmp, file)
    9. recompute diff: [{ path, from, to }]
    10. respond { ok, diff, newMtime, requiresRestart: diff.some(...) }
    ↓ client
DiffModal closes
if requiresRestart → RestartPromptModal
    user clicks "Restart now"
    ↓
POST /api/admin/server/restart
    ↓ route (require ADMIN)
lifecycleMutex.acquire() → if busy: 409 'lifecycle-busy'
gracefulRestart(warningSeconds=30):
    now = Date.now()
    publish('server:lifecycle', { phase: 'warning', detail: `${warningSeconds}s` })
    rcon servermsg `Server restarting in ${warningSeconds}s (config reload). Please log out.`
    await sleep(warningSeconds * 1000) — full budget; message is truthful
    publish 'saving'
    rcon save  → await RCON response line "World saved" or timeout 120s
                 (PZ's save is synchronous on the RCON channel; we wait for the
                 terminator line, not a blind sleep). On timeout: WARN log +
                 proceed to quit anyway.
    publish 'stopping'
    rcon quit                                      (initiates clean shutdown)
    waitForState('pz-server', 'exited', 90000)     — poll /containers/pz-server/json
                                                      every 2s via proxy
    if still running after 90s → stopPz(t=30)      (proxy POST /stop?t=30)
    if still running after another 35s → killPz()  (proxy POST /kill)
    publish 'starting'
    startPz()                                      (proxy POST /start)
    waitForState('pz-server', 'running', 600000)   — B42 big modlist can be slow
                                                      on first-run; normal boot
                                                      after that is ~60-120s.
    if running but the process dies within 30s post-start:
       publish 'idle' { detail: 'start-failed', exitCode }
    else:
       publish 'idle'
    return 200 { durationMs: Date.now() - now }
    ↓ finally
lifecycleMutex.release()
```

### Graceful edge cases

- **RCON is already down** when `Stop`/`Restart` is invoked → detected by initial RCON ping; skip RCON ceremony, log warning, go straight to docker stop with `t=30` (so PZ's signal handler still gets a chance to save).
- **`rcon save` never returns** → 120s timeout; log WARN; proceed to quit. UI shows `phase: 'saving'` with a `detail: 'save-timeout-proceeding'` marker.
- **docker start returns but container exits within 30s** (PZ crashed on boot) → emit `phase: 'idle'` with `detail: 'start-failed', exitCode` and surface in UI with a red banner + "View last 100 log lines" quick action.
- **docker-socket-proxy unreachable** → lifecycle routes return 503 `code: 'proxy-unreachable'`; `/api/admin/server/state` reports `proxyReachable: false`; UI renders controls disabled with a clear error badge; users revert to SSH fallback (documented in UI tooltip).
- **Concurrent panel edits** (two admins) → mtime-race → client reloads draft with diff markers; warns.
- **Lifecycle double-click** (ADMIN presses Restart twice fast) → mutex rejects second with 409; UI disables the button for the duration.
- **Descriptor drift** (file contains a key we don't know) → preserve on write; UI shows "Unknown key" pill with a raw string input (editable) so mod-added sandbox keys aren't stranded.
- **Out-of-range value committed previously** (e.g. someone set via SSH) → displayed with warning border; still editable.
- **Abort current phase (ADMIN, `rcon save` stuck 60s+)** → separate endpoint `POST /api/admin/server/abort` (ADMIN+) cancels the in-flight graceful op, releases the mutex, and force-stops. Audit log records the abort with the phase it was in.

### Logs fix

No code change required. The existing `lib/ws/log-streamer.ts` + `lib/docker/client.ts` + `/admin/logs` pipeline all work — the only broken link is that `/var/run/docker.sock` isn't mounted into the production container. Chunk 1 adds the mount; Chunk 5 end-to-end verification confirms logs arrive.

Secondary improvement: the current streamer warns "container not found or Docker socket unavailable" — make that message more specific so this class of outage is easier to diagnose (distinguish "socket missing" from "container missing" in the published log line).

## Security model

| Action | Role | Rationale |
|---|---|---|
| View config | VIEWER | No secrets in ini (RCON password aside — blurred in UI) |
| Edit config | OWNER | Changes gameplay |
| Start / Stop / Restart | ADMIN | Operational; trusted admins have this |
| Force stop | OWNER | Can lose up-to-autosave progress |
| View logs | MODERATOR | (unchanged) |

**RCON password handling.** Server-side redaction: the `/api/admin/config/ini` GET strips `RCONPassword` (and `AdminPassword`, `ServerPassword` if present) from the response for any role below OWNER — replaced with the sentinel `"__REDACTED__"` and a `redacted: true` flag per key. A separate `GET /api/admin/config/ini/secrets` (OWNER only) returns just those fields unredacted, used by the "reveal" toggle. This prevents a casual VIEWER inspecting DevTools from reading the secret.

**CSRF.** Auth.js already issues a CSRF token for its own endpoints at `/api/auth/csrf` (and writes a `next-auth.csrf-token` cookie). We reuse that: the PUT endpoints accept `X-CSRF-Token` header and validate it matches the cookie value. A small client helper `lib/csrf/fetch.ts` wraps `fetch` to auto-inject the header from the cookie on any mutating method — no new cookie plumbing. Any mismatch → 403 `code: 'csrf'`. This avoids inventing a parallel CSRF scheme.

**Rate limit.** 10 mutating calls/min per user via in-memory counter (`Map<userId, { count, resetAt }>`). Scoped to saves + lifecycle actions (separate quotas: 10 saves/min, 5 lifecycle actions/min). **Single-instance assumption** — pz-crcon runs as one replica (no horizontal scale). Horizontal scaling would require moving the counter to Redis; documented as a follow-on.

**Audit log.** New Prisma model `AuditEvent { id, userId, kind, detail, createdAt }` with `kind` enum `CONFIG_WRITE | LIFECYCLE_START | LIFECYCLE_STOP | LIFECYCLE_RESTART | LIFECYCLE_FORCE_STOP | LIFECYCLE_ABORT`. Writes persist `{ file, diff }` in `detail` JSON; lifecycle persists `{ phase, duration, warningSeconds, outcome }`. Exposed read-only at `GET /api/admin/audit?cursor=&limit=` (MODERATOR+). UI: small recent-events card on `/admin` (below server controls).

## Data: descriptors

### SandboxVars

Data source: PZ ships `media/lua/shared/Sandbox/ServerSandboxOptions.lua` with defaults. Plus `pzwiki.net/wiki/Sandbox` has human labels + descriptions. Approach:

1. Seed types + defaults from the game file (ship the file in `data/pz/`).
2. Hand-author `help` and `options` (for enums) from the wiki — this is the M2 curated pass.

Each entry:
```ts
{
  path: "Zombies.Speed",                        // dot-path matches parser flat keys
  label: "Zombie speed",
  section: "Zombies",
  type: "enum",
  options: [
    { value: 1, label: "Sprinters" },
    { value: 2, label: "Fast shamblers" },
    { value: 3, label: "Shamblers" },
    { value: 4, label: "Random" },
  ],
  default: 4,
  help: "Controls the base zombie movement speed. Random picks per-zombie.",
  requiresRestart: true,
}
```

We will cover **every key present in a fresh servertest_SandboxVars.lua** (stock B42). **Mod-added keys** (some of our 53 mods inject their own sandbox fields) are handled by the fallback path: no descriptor → the UI renders the raw parsed type (bool→Switch, number→Input, string→Input) with label = `decamelCase(key)`, help = "(mod-added key, see mod docs)", and a muted `[mod]` badge. Coverage test enforces: every key in the **stock fixture** has a descriptor; mod-added keys are allowed to be descriptor-less. A secondary fixture copied from the live `MajorlukPZ_SandboxVars.lua` is checked in at `tests/fixtures/live-sandbox.lua` to snapshot the mod-key shape we see in practice.

### server.ini

Same shape. Extend `ini-descriptors.ts` from the current ~30 keys to full coverage of every documented server.ini field (~120).

## Testing

Unit (`tests/unit/pz/`):

- `writer.round-trip.test.ts` — parse → write-patch → parse equals patched on `servertest_SandboxVars.lua` and `live-sandbox.lua` fixtures (fuzz: 1000 random patches per file)
- `writer.preserves-shape.test.ts` — original comments / blank lines / indentation / trailing whitespace / EOL style preserved in both serializers
- `writer.source-offsets.test.ts` — sandbox parser emits offsets for every key in fixture; serialize refuses (`code: 'serialize-shape-unsupported'`) for synthetic multi-pair-per-line input
- `writer.backup.test.ts` — `.bak-<iso>` created in `.backups/`, 11th backup prunes oldest (including clock-skew scenario where timestamps are out of order)
- `writer.mtime-race.test.ts` — concurrent panel write gets 409
- `writer.config-busy.test.ts` — `async-mutex` serializes writes; second call returns `code: 'config-busy'`
- `writer.lifecycle-gate.test.ts` — write during non-`idle` phase returns `code: 'lifecycle-busy'`
- `writer.fs-errors.test.ts` — ENOSPC / EACCES / read-only FS → typed error, no partial file on disk
- `validate.test.ts` — out-of-range / unknown-key / wrong-type all rejected
- `lifecycle.test.ts` — mocked RCON + docker-control, asserts phase progression including: rcon-down skip, save-timeout fallthrough, start-failed detection, mutex double-click, abort endpoint
- `lifecycle.proxy-down.test.ts` — 503 + UI state when proxy is unreachable
- `descriptors.coverage.test.ts` — every key in stock `servertest_SandboxVars.lua` has a descriptor; mod-added keys in `live-sandbox.lua` may not
- `access-check.test.ts` — `/api/admin/config/access` reflects `configAccessOk` flag; writes 503 when false
- `secrets.redaction.test.ts` — non-OWNER gets `"__REDACTED__"` for RCON/Admin/Server passwords in GET; OWNER endpoint returns real values

Integration (`tests/integration/`):

- `api.config.test.ts` — PUT requires OWNER, CSRF enforced, mtime lock, diff is correct, rate-limit after 10/min
- `api.server.test.ts` — lifecycle routes require ADMIN, emit WS events, concurrent restart → 409, abort endpoint works
- `docker-proxy.endpoints.test.ts` — CI smoke test that spins up a `tecnativa/docker-socket-proxy` with the exact env matrix and hits each endpoint we depend on; asserts 200 for allowed verbs + 403 for disallowed (exec, volumes, etc.). Runs in docker-in-docker in the GH Actions job.

Manual (post-deploy, against live `pz-server`):

- Open `/admin/config`, flip `PopulationMultiplier` 0.65 → 1.0, save → diff confirms → restart prompt appears
- Restart via dashboard, watch live phase badge transitions (`warning` → `saving` → `stopping` → `starting` → `idle`), `servermsg` appears in-game, PZ container bounces, rejoin → verify change applied
- `/admin/logs` shows live lines; kill docker-socket-proxy → page shows diagnostic, restore → lines resume
- Force stop confirm dialog requires exact-match confirm text (`FORCE-STOP`)
- Rollback drill: stop docker-socket-proxy, revert compose to Chunk 0 state (no mounts), `docker compose up -d --force-recreate`, `/admin/logs` degrades gracefully, SSH path still functional
- Watchtower race: trigger `docker compose pull` mid-restart → lifecycle completes or aborts cleanly; no corrupted container state

## Chunks

Tight, each one merges to a working state. **Chunk 1 mounts `pz-data` read-only**; Chunk 3 upgrades to `:rw` when the writer is ready — narrows the window during which the wider surface is exposed.

1. **Infra + logs fix + access-check + reader-switch** —
   - Compose: `user: 1000:1000`, `pz-data:/pz-data:ro`, `docker.sock:ro`, `docker-socket-proxy` service with full env matrix, `pz-control-net` network.
   - `lib/pz/access-check.ts` boot-time check; `GET /api/admin/config/access` route.
   - Switch `lib/pz/config-reader.ts` to FS path (falls through to `{ ok: false }` if unreachable).
   - Fix log-streamer diagnostic messages to distinguish socket-missing vs container-missing.
   - Ensure `installLogStreamer()` is wired at WS server boot (verify in `lib/ws/server.ts`).
   - Acceptance: `/admin/logs` shows lines; `/api/admin/config/access` returns `{ ok: true }`; `/admin/config` still renders (read-only).
2. **Descriptor data (full M2)** —
   - Check in `data/pz/ServerSandboxOptions.lua` (B42 stock).
   - Extend `lib/pz/ini-descriptors.ts` from ~30 to full coverage (~120 keys).
   - New `lib/pz/sandbox-descriptors.ts` with ~130 curated entries.
   - Coverage test on stock + live fixtures.
3. **Writer + validators + source-offset parser** —
   - Extend `parse-sandbox-lua.ts` to emit source offsets.
   - `serialize-ini.ts`, `serialize-sandbox-lua.ts`.
   - `lib/pz/writer.ts` with mutex, mtime lock, `.backups/` retention.
   - `lib/pz/validate.ts` with Zod.
   - `async-mutex` npm dep.
   - **Compose flip: `pz-data:/pz-data:rw`** (deploy step in this chunk).
   - Audit log Prisma model + migration.
   - All unit tests green.
4. **Config API + editable UI + audit** —
   - `PUT /api/admin/config/ini` and `.../sandbox` with CSRF, rate-limit, secrets redaction.
   - `GET /api/admin/audit` route + small card on `/admin`.
   - Typed controls (`SandboxVarControl`), dirty tracking, per-section Save button.
   - `DiffModal`, `RestartPromptModal` — **Restart button disabled** in this chunk with tooltip "Lifecycle ships in Phase 1.7 Chunk 5".
   - Acceptance: round-trip edit → save → diff → restart-prompt shows (restart button disabled), audit row persists.
5. **Lifecycle + abort** —
   - `lib/docker/control.ts` (TCP dockerode → proxy).
   - Extend `lib/rcon/commands.ts` with `servermsg`, `save`, `quit`, `reloadoptions`; `save` awaits terminator line.
   - `lib/server/lifecycle.ts` with mutex, phase broadcast, timeouts, abort.
   - API routes: `start`, `stop`, `restart`, `force-stop`, `abort`, `state`.
   - `ServerControlsCard` wired to WS `server:lifecycle`; enable RestartPromptModal button.
   - Acceptance: start/stop/restart/force-stop all work on live container with visible phase progression; abort recovers a stuck save; concurrent clicks get 409.

Deployment at each chunk via Watchtower (push to main → DockerHub → auto-pull). Compose changes are one-time on the host — Chunk 1 installs mounts + proxy; Chunk 3 flips `:ro` → `:rw`.

## Rollback

- Compose: `docker-socket-proxy` is isolated on its own network; removing the service and reverting the `:ro` / `:rw` volumes restores prior behavior. No state to migrate.
- Writer: `.bak-<ts>` chain lives on disk; restoring is `cp <bak> <original>`.
- Lifecycle: if misbehaves, the old SSH path is always available.

## Open questions

None blocking. The `changeoption` live-tuning improvement and scheduled restart are both tracked as follow-ons outside this phase.
