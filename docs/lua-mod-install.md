# PZ-CRCON Companion Lua Mod — Install Guide

Server-side companion that streams player positions, deaths, heartbeats,
and helicopter events out to the pz-crcon admin panel's
`/api/webhook/mod` endpoint. Everything that shows "needs Lua mod" on
the panel (In-game Time, Weather, live TPS, player dots on the Knox
map) lights up once this is installed and configured.

The mod is **server-only** — players don't need to install anything.

---

## 1. Copy the mod into the PZ server's `mods/` dir

From this repo:

```
mods/pz-crcon/
├── mod.info
└── media/lua/server/
    ├── PZCrcon.lua
    ├── PZCrcon_Config.lua
    ├── PZCrcon_Events.lua
    ├── PZCrcon_Hmac.lua
    ├── PZCrcon_Http.lua
    └── PZCrcon_Json.lua
```

On HomePL the PZ server stores its mods in the `pz-server-files`
volume:

```bash
ssh -p 2222 -i ~/.ssh/id_ed25519 root@85.215.222.81

# Copy the mod tree into the volume. The mod id is `PZCrcon`.
docker cp /path/to/pz-crcon/mods/pz-crcon \
  pz-server:/home/steam/Zomboid/mods/PZCrcon
docker exec -u root pz-server chown -R steam:steam \
  /home/steam/Zomboid/mods/PZCrcon
```

(If the `Zomboid/mods/` dir doesn't exist yet, create it first with the
same ownership.)

Workshop install is equivalent — when a Workshop-published copy ships,
`3713221548`-style IDs resolve to this same directory automatically.

## 2. Create the config file

On the PZ server volume, drop a plain-text `Zomboid/Server/PZCrcon.cfg`
with operator-supplied values:

```bash
docker exec -u steam pz-server sh -c 'cat > /home/steam/Zomboid/Server/PZCrcon.cfg <<EOF
# Required — must match pz-crcon's WEBHOOK_HMAC_SECRET env var exactly.
secret=<paste WEBHOOK_HMAC_SECRET here>

# Optional overrides — defaults shown below.
endpoint=https://pz.majorluk.pl/api/webhook/mod
serverId=majorlukpz
tickMs=5000
heartbeatMs=30000
maxEventsPerPost=50
includeInvisible=false
enableDebug=false
EOF'
```

**Important:** `secret` must be IDENTICAL to the `WEBHOOK_HMAC_SECRET`
environment variable on the pz-crcon container (check
`/opt/docker/pz-crcon/.env`). Any mismatch → HMAC fails → panel
returns 401.

## 3. Enable the mod in the server INI

Either through the panel's Mod Manager (`/admin/mods` → Add with the
local mod id `PZCrcon` — no Workshop ID yet), or edit
`Zomboid/Server/<prefix>.ini`:

```
Mods=…existing…;PZCrcon
WorkshopItems=…existing…
```

Do **not** add anything to `WorkshopItems=` — this mod is local, not
Workshop-published yet.

## 4. Restart PZ to load the mod

From the panel: `/admin` → Server Controls → **Restart** (graceful
save + stop + start). Or via SSH:

```bash
ssh -p 2222 -i ~/.ssh/id_ed25519 root@85.215.222.81 docker restart pz-server
```

## 5. Verify

On server startup the PZ console should print:

```
[PZCrcon] Companion mod booting — endpoint=https://pz.majorluk.pl/api/webhook/mod
[PZCrcon] Event hooks installed
```

(View from the panel: `/admin/logs`.)

Within 30 seconds the first heartbeat POST lands at the panel, and:

- `/admin` Status cards show live **In-game Time**, **Weather**,
  and **TPS** — no more `—`.
- `/admin/map` Knox map shows real per-player dots at 2-second ticks.
- The public `https://pz.majorluk.pl/` landing page shows the same
  dots anonymised (250-tile grid, `Survivor-<token>` names, 30 s).
- Death events appear in `/api/events` + Discord notifications
  (if the webhook is configured).

## Troubleshooting

### No `[PZCrcon]` lines in the server log

- Verify the files landed in the right path:
  `docker exec pz-server ls /home/steam/Zomboid/mods/PZCrcon/media/lua/server/`.
- Check the mod appears in `Mods=` in the live INI.
- Confirm the mod appears in PZ's admin menu listing.

### `POST code=401` in debug mode

- HMAC secret mismatch. Re-copy `WEBHOOK_HMAC_SECRET` from the
  pz-crcon `.env` into `PZCrcon.cfg`.
- Clock skew > 60 s between the PZ host and the panel host.

### `POST code=0 err=luanet-unavailable`

- PZ < 41.78 — the mod requires the newer Lua<->Java bridge that
  exposes `javax.crypto.Mac`. Upgrade the dedicated server.

### `POST code=0 err=<NetworkError>`

- pz-server (in `host` network mode) can't reach the panel URL.
  Check DNS + firewall. If the panel is on the same host, you can
  point `endpoint=http://127.0.0.1:3000/api/webhook/mod` as long as
  port 3000 is exposed from the pz-crcon container.

### Enable debug output

Set `enableDebug=true` in `PZCrcon.cfg` and `/reloadlua PZCrcon` from
the in-game admin console (or restart). The mod will log every POST
attempt with status code and error detail.

## Rotating the HMAC secret

Zero-downtime rotation:

1. On pz-crcon, set `WEBHOOK_HMAC_SECRET_NEXT=<new>` alongside the
   current secret. Redeploy.
2. Update `PZCrcon.cfg` on the PZ server with the new secret. The
   mod's outgoing `X-Pz-Secret-Rev` header defaults to `current`, so
   the panel will check the "current" slot — add a line
   `secretRev=next` to send it as the "next" slot instead.
3. Once the mod is pushing with the new key and you've verified
   panel 200s, promote `_NEXT` to `WEBHOOK_HMAC_SECRET` and remove
   the `_NEXT` env. Redeploy.

## What the mod does NOT do

- Does **not** ship with a custom client-side UI or menu.
- Does **not** persist any data on the PZ server — everything is
  either in-memory buffers or immediately POSTed.
- Does **not** run on the client. Players are unaffected.
- Does **not** try to modify sandbox behaviour, loot, zombies, or
  anything gameplay-adjacent. Pure observability.
