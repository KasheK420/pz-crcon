# PZ-CRCON — Config Editor, Server Controls & Log Viewer Fix

**Phase:** 1.7
**Date:** 2026-04-20
**Status:** Draft → Review
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

Three compose changes to `/opt/docker/pz-crcon/docker-compose.yml`:

1. **Bind-mount `pz-data` volume into pz-crcon** as read-write at `/pz-data`. This is the same named volume already owned by `pz-server`. Config files land at `/pz-data/Server/<prefix>.{ini,lua}`.
2. **Mount `/var/run/docker.sock:ro`** into pz-crcon for logs tailing, container stats, and env/inspect lookups. Already wired through `lib/docker/client.ts` but never reached production.
3. **Add `tecnativa/docker-socket-proxy`** sidecar with `CONTAINERS=1 POST=1` on an isolated `pz-control-net` network, bound only to pz-crcon. This is the only route for mutating operations (start/stop/restart). The proxy refuses `/exec`, `/volumes`, `/networks`, etc., so even if pz-crcon is compromised the blast radius is "bounce the PZ container".

```yaml
# excerpt
services:
  pz-crcon:
    volumes:
      - pz-data:/pz-data:rw
      - /var/run/docker.sock:/var/run/docker.sock:ro
    environment:
      PZ_CONFIG_DIR: /pz-data/Server
      PZ_SERVER_DIR: /pz-data/Server          # existing var, re-pointed
      DOCKER_CONTROL_URL: http://docker-socket-proxy:2375
      PZ_CONTAINER_NAME: pz-server
    networks:
      - proxy-net
      - db-net
      - pz-control-net

  docker-socket-proxy:
    image: tecnativa/docker-socket-proxy:latest
    container_name: pz-crcon-socket-proxy
    environment:
      CONTAINERS: 1
      POST: 1
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    networks:
      - pz-control-net
    restart: unless-stopped

volumes:
  pz-data:
    external: true

networks:
  pz-control-net:                 # new, not shared with anything else
```

The `pz-data` volume was created by pz-server compose under `name: pz-data`, so `external: true` picks it up without duplication.

### Module layout

**New modules:**

| Path | Responsibility |
|---|---|
| `lib/pz/writer.ts` | `writeServerIni(patch, opts)`, `writeSandboxVars(patch, opts)` — atomic file write (write tmp → fsync → rename), `.bak-<iso>` backup, retention of last 10 backups per file, mtime-based optimistic locking |
| `lib/pz/ini-descriptors.ts` (extend) | Grow to full coverage of every documented server.ini key; add `type`, `enum`, `min`, `max`, `step`, `default` fields |
| `lib/pz/sandbox-descriptors.ts` (new) | Curated metadata for every sandbox var (~130 entries) — `{ path, label, type, min, max, step, options, help, section, default }` |
| `lib/pz/validate.ts` | `validateIniPatch(patch, descriptors)`, `validateSandboxPatch(patch, descriptors)` returning Zod results; rejects unknown keys and out-of-range values |
| `lib/pz/serialize-ini.ts` | Take the original raw ini + a patch map, produce new ini text preserving comments, order, blank lines, and case |
| `lib/pz/serialize-sandbox-lua.ts` | Same for the Lua file — preserve structure, only rewrite scalar values we know about |
| `lib/docker/control.ts` | HTTP client for `docker-socket-proxy`: `startPz()`, `stopPz(timeoutS)`, `restartPz(timeoutS)`, `inspectPz()` |
| `lib/rcon/commands.ts` (extend) | Add `servermsg(text)`, `save()`, `quit()`, `reloadoptions()` helpers |
| `lib/server/lifecycle.ts` | Orchestrates graceful flows: `gracefulRestart()`, `gracefulStop()`. Uses RCON for in-game warning + save, then Docker. Emits WS events per phase. |
| `lib/ws/channels.ts` (extend) | Add `server:lifecycle` channel with phase payload `{ phase: 'idle'|'warning'|'saving'|'stopping'|'starting', at, detail? }` |

**Modified modules:**

| Path | Change |
|---|---|
| `lib/pz/config-reader.ts` | Switch from `readContainerFile` (docker-exec) to direct `fs.readFile` on `PZ_CONFIG_DIR`. Keep docker-exec path as fallback so local dev without the bind-mount still works. |
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
lib/server/lifecycle.ts gracefulRestart():
    publish('server:lifecycle', { phase: 'warning', detail: '30s' })
    rcon servermsg "Server restarting in 30s (config reload). Please log out."
    sleep 5s
    publish 'saving'
    rcon save
    sleep 25s
    publish 'stopping'
    rcon quit                                      (initiates clean shutdown)
    wait inspect → exited (poll proxy) with 60s cap → if still running: docker stop
    publish 'starting'
    docker start pz-server
    wait inspect → running with 600s cap (B42 big modlist)
    publish 'idle'
    return 200
```

### Graceful edge cases

- **RCON is already down** when `Stop` is invoked → skip RCON ceremony, log warning, go straight to docker stop.
- **docker start returns but container exits within 30s** (PZ crashed on boot) → emit `phase: 'idle'` with `detail: 'start-failed'` and surface in UI.
- **Concurrent edits** (two admins) → mtime-race → client reloads draft, warns.
- **Descriptor drift** (file contains a key we don't know) → preserve on write; UI shows "Unknown key" pill, no control rendered.
- **Out-of-range value committed previously** (e.g. someone set via SSH) → displayed with warning border; still editable.

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

RCON password is masked in the ini view (shown as `••••••` with reveal toggle for OWNER only).

All write endpoints protected by:
- Role check (via existing `atLeast()`)
- CSRF: Next.js server actions are same-origin; API PUTs require `X-CSRF-Token` header matching a cookie set on page load (new utility, keeps this clean)
- Rate limit: 10 saves/min per user (in-memory counter)

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

We will cover **every key present in a fresh servertest_SandboxVars.lua** so there are no unknown-key pills in the default state.

### server.ini

Same shape. Extend `ini-descriptors.ts` from the current ~30 keys to full coverage of every documented server.ini field (~120).

## Testing

Unit (`tests/unit/pz/`):

- `writer.round-trip.test.ts` — parse → write-patch → parse equals patched
- `writer.preserves-shape.test.ts` — original comments / blank lines / ordering preserved in `serialize-ini` and `serialize-sandbox-lua`
- `writer.backup.test.ts` — `.bak-<iso>` created, 11th backup prunes oldest
- `writer.mtime-race.test.ts` — concurrent write gets 409
- `validate.test.ts` — out-of-range / unknown-key / wrong-type all rejected
- `lifecycle.test.ts` — mocked RCON + docker-control, asserts phase progression
- `descriptors.coverage.test.ts` — for every key in `tests/fixtures/servertest_SandboxVars.lua` there is a matching descriptor

Integration (`tests/integration/`):

- `api.config.test.ts` — PUT requires OWNER, mtime lock, diff is correct
- `api.server.test.ts` — lifecycle routes require ADMIN, emit WS events

Manual (post-deploy):

- Open `/admin/config`, flip `PopulationMultiplier` 0.65 → 1.0, save, diff confirms, restart prompt appears
- Restart via dashboard, watch live countdown in UI, PZ container bounces, join game → verify change applied
- `/admin/logs` shows live lines
- Force stop confirm dialog requires exact-match confirm text

## Chunks

Tight, each one merges to a working state:

1. **Infra + logs fix** — compose (volume + socket:ro + proxy + pz-control-net), ensure `installLogStreamer()` called on boot, deploy. Acceptance: `/admin/logs` shows lines, `/api/admin/host-stats` works (already did, regression check).
2. **Descriptor data** — extend `ini-descriptors.ts`, add `sandbox-descriptors.ts` + `data/pz/ServerSandboxOptions.lua` seed file, coverage test passes on servertest fixture.
3. **Writer + validators** — `serialize-ini.ts`, `serialize-sandbox-lua.ts`, `writer.ts`, `validate.ts`, all unit tests green.
4. **Config API + editable UI** — PUT endpoints, typed controls, DiffModal, RestartPromptModal, config-reader switched to FS path. Acceptance: round-trip edit → save → diff → restart-prompt via UI in dev.
5. **Lifecycle** — `lib/docker/control.ts`, `lib/rcon/commands.ts` additions, `lib/server/lifecycle.ts`, lifecycle API routes, `ServerControlsCard` + WS phase broadcast. Acceptance: start/stop/restart/force-stop all work on live container with visible phase progression.

Deployment at each chunk via the existing Watchtower pipeline (push to main → DockerHub → auto-pull). Compose change in Chunk 1 is one-time on the host.

## Rollback

- Compose: `docker-socket-proxy` is isolated on its own network; removing the service and reverting the `:ro` / `:rw` volumes restores prior behavior. No state to migrate.
- Writer: `.bak-<ts>` chain lives on disk; restoring is `cp <bak> <original>`.
- Lifecycle: if misbehaves, the old SSH path is always available.

## Open questions

None blocking. The `changeoption` live-tuning improvement and scheduled restart are both tracked as follow-ons outside this phase.
