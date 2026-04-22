# Deployment

Operator runbook for shipping `pz-crcon` to the **HomePL VPS** at
`https://pz.majorluk.pl`. Run-once setup, then every push to `main` is
shipped automatically by Watchtower.

> All commands assume you have:
>
> - SSH access to HomePL (`ssh -p 2222 -i ~/.ssh/id_ed25519 root@85.215.222.81`)
> - Tailscale up (NPM admin and pgAdmin are Tailscale-only)
> - The workspace `.env` with `PG_SUPERUSER_PASSWORD` available
> - DockerHub creds stored as GitHub secrets `DOCKERHUB_USERNAME` /
>   `DOCKERHUB_TOKEN` (set once via `gh secret set`)

---

## 0. Architecture recap

```
Cloudflare (DNS + Tunnel)
        │  pz.majorluk.pl
        ▼
cloudflared (HomePL container)  ─── proxy-net
        │
        ▼
nginx-proxy-manager  (HomePL)   ─── proxy-net
        │  forward → pz-crcon:3000
        ▼
pz-crcon container              ─── proxy-net + db-net
        │
        ▼                                  ▲
shared-postgres (HomePL)        ─── db-net │
                                            │  RCON over public IP
                                            │  85.215.222.81:27015
                                            │  (per ADR 0001)
```

The `pz-crcon` container connects to the PZ server via the **public IP**
(`RCON_HOST=85.215.222.81`) — see ADR 0001 for the rationale.

---

## 1. One-time DockerHub + GitHub setup (local machine)

Already done if `gh secret list --repo KasheK420/pz-crcon` shows both
secrets. Otherwise:

```bash
gh secret set DOCKERHUB_USERNAME --body "majorluk" --repo KasheK420/pz-crcon
gh secret set DOCKERHUB_TOKEN    --body "<dckr_pat_…>" --repo KasheK420/pz-crcon
```

After the next push to `main`, the `release.yml` workflow will publish
`majorluk/pz-crcon:latest` and `:<short-sha>`. Watchtower on HomePL polls
DockerHub every 5 minutes and will redeploy automatically once the image
is up.

---

## 2. One-time HomePL bootstrap

### 2.0 Prerequisites on the PZ server host

`pz-crcon` shares the `pz-data` docker volume with the `pz-server`
container so both see the same `Saves/`, `Server/`, `Workshop/`, etc.
Two hostside steps are required for the shared volume to actually be
shared and for all features (wipe world, config editor, console attach)
to work.

**(a) Unify volume ownership to `1000:1000`.** The upstream
`renegademaster/zomboid-dedicated-server` image initialises some paths
as `root:root` and others as `botdev` (uid 1000). `pz-crcon` runs as
`user: "1000:1000"` and needs write access to everything under the
volume (to rename a world into `.trash-*` for "Wipe world", to write
config via the editor, etc.). Without this, the Wipe button surfaces
a `data-path-not-writable` error and config edits fall back to
`config-dir-unreachable`.

Apply it once, on the PZ host:

```bash
# stop pz-server first so PZ doesn't race the chown
docker stop pz-server
chown -R 1000:1000 /var/lib/docker/volumes/pz-data/_data
docker start pz-server
```

Ownership is preserved for all writes made by PZ after this, since the
in-container `botdev` user is also uid 1000.

**(b) Enable TTY + stdin on the `pz-server` service.** Without
`tty: true` + `stdin_open: true`, the Portainer "Console → Attach"
screen for `pz-server` shows an empty tty and can't send RCON
commands. Edit `/opt/docker/projectzomboid/docker-compose.yml` and add
those two keys under the `pz-server` service. A restart is not needed
immediately — the change takes effect on the next `docker compose
up -d`.

```yaml
services:
  pz-server:
    # ... existing config ...
    tty: true
    stdin_open: true
```

### 2.1 Create the project directory

```bash
ssh -p 2222 -i ~/.ssh/id_ed25519 root@85.215.222.81 \
  "mkdir -p /opt/docker/pz-crcon"
```

### 2.2 Copy the production compose + bootstrap script

From your local repo root:

```bash
bash scripts/deploy.sh
```

This copies:

- `docker/docker-compose.deploy.yml` → `/opt/docker/pz-crcon/docker-compose.yml`
- `scripts/bootstrap-db.sh`           → `/opt/docker/pz-crcon/bootstrap-db.sh`

(`deploy.sh` only copies files; it does not start the container yet.)

### 2.3 Bootstrap the Postgres role + database

On the server:

```bash
ssh -p 2222 -i ~/.ssh/id_ed25519 root@85.215.222.81
cd /opt/docker/pz-crcon

# Generate a fresh password for the app DB user
PZ_DB_PASSWORD="$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)"
echo "PZ_DB_PASSWORD=${PZ_DB_PASSWORD}"   # save to your password manager

PG_SUPERUSER_PASSWORD="<from workspace .env>" \
PZ_DB_PASSWORD="${PZ_DB_PASSWORD}" \
  ./bootstrap-db.sh
```

The script is idempotent — re-running it just resets the password to the
one you pass in.

### 2.4 Create `/opt/docker/pz-crcon/.env`

```bash
cat > /opt/docker/pz-crcon/.env <<'EOF'
NODE_ENV=production
APP_URL=https://pz.majorluk.pl
NEXTAUTH_URL=https://pz.majorluk.pl
NEXTAUTH_SECRET=<openssl rand -base64 32>
LOG_LEVEL=info
WS_HEARTBEAT_SEC=30

# Postgres on the shared instance (note the docker DNS name shared-postgres)
DATABASE_URL=postgresql://pzcrcon_user:<PZ_DB_PASSWORD>@shared-postgres:5432/pzcrcon

# Discord OAuth (no bot needed; identity only)
DISCORD_CLIENT_ID=<your app id>
DISCORD_CLIENT_SECRET=<your app secret>
# Comma-separated allowlist; the FIRST id becomes OWNER on first login,
# the rest become ADMIN. Anyone not listed is rejected.
DISCORD_ADMIN_IDS=286560250578862080

# PZ RCON — uses the public IP per ADR 0001 (bridge container can't see host net)
RCON_HOST=85.215.222.81
RCON_PORT=27015
RCON_PASSWORD=<from PZ server config>

# Lua mod webhook (Phase 4 — set now to satisfy env validator)
WEBHOOK_HMAC_SECRET=<openssl rand -base64 32>

# Backups (Phase 3 — placeholder)
BACKUP_PATH=/var/lib/pz-crcon/backups
BACKUP_RETENTION_DAYS=14
EOF
chmod 600 /opt/docker/pz-crcon/.env
```

> **Discord OAuth redirect URI** must be added in the Discord Developer
> Portal for this app:
> `https://pz.majorluk.pl/api/auth/callback/discord`

### 2.5 Pull and start

```bash
cd /opt/docker/pz-crcon
docker compose pull
docker compose up -d
docker compose logs -f --tail=200 pz-crcon
```

### 2.6 Run Prisma migrations

```bash
docker exec -it pz-crcon npx prisma migrate deploy
```

### 2.7 Hook up NPM (Nginx Proxy Manager)

NPM admin is at `http://100.114.204.59:81` (Tailscale only). The admin
account has 2FA, so the API is **interactive only**.

**Preferred — UI workflow:**

1. Log in to NPM admin (Tailscale).
2. Hosts → Proxy Hosts → **Add Proxy Host**.
3. **Domain Names:** `pz.majorluk.pl`
4. **Forward Hostname/IP:** `pz-crcon`
5. **Forward Port:** `3000`
6. Toggles: **Block Common Exploits** ON, **Websockets Support** ON,
   **Cache Assets** OFF.
7. **SSL** tab: leave SSL certificate set to "None" — TLS is terminated
   by Cloudflare Tunnel upstream of NPM.
8. Save.

**Fallback — sqlite edit (use only if UI is unavailable):**

```bash
docker exec -it nginx-proxy-manager sqlite3 /data/database.sqlite
# At the sqlite prompt:
INSERT INTO proxy_host (
  created_on, modified_on, owner_user_id, domain_names, forward_scheme,
  forward_host, forward_port, access_list_id, certificate_id,
  ssl_forced, caching_enabled, block_exploits, advanced_config,
  meta, allow_websocket_upgrade, http2_support, hsts_enabled,
  hsts_subdomains, enabled
) VALUES (
  datetime('now'), datetime('now'), 1, '["pz.majorluk.pl"]', 'http',
  'pz-crcon', 3000, 0, 0,
  0, 0, 1, '',
  '{"letsencrypt_agree":false,"dns_challenge":false}', 1, 0, 0,
  0, 1
);
.quit
docker exec -it nginx-proxy-manager bash -c "/app/bin/index.js reload" \
  || docker restart nginx-proxy-manager
```

> NPM container DNS resolves `pz-crcon` because both containers are on
> the `proxy-net` Docker network. If resolution fails, double-check that
> the `pz-crcon` service joined `proxy-net` — `docker network inspect
> proxy-net | grep pz-crcon`.

### 2.8 Cloudflare side (already done by Lukas before this chunk)

- DNS: CNAME `pz.majorluk.pl` → `<tunnel-uuid>.cfargotunnel.com` (proxied)
- Tunnel public hostname: `pz.majorluk.pl` → service `http://nginx-proxy-manager:80`

If for any reason this is not done yet, do it via the Zero Trust dashboard
under **Networks → Tunnels → <homepl-tunnel> → Public Hostname**.

### 2.9 Verify

```bash
# From your local machine
bash scripts/verify-deploy.sh https://pz.majorluk.pl
```

Expected output: `OK: MajorlukPZ online= true players= N`.

Then in a browser:

1. Visit `https://pz.majorluk.pl` → public map page renders, server
   status widget shows "online".
2. Click "Sign in with Discord" → OAuth round-trips back to
   `/admin/overview`. Your row in `User` should have `role=OWNER`.

---

## 3. Day-to-day deploys

You don't need to do anything: every push to `main` triggers
`release.yml`, which builds and pushes `majorluk/pz-crcon:latest`.
Watchtower on HomePL pulls the new image within 5 minutes and restarts
the container.

To force a redeploy immediately:

```bash
ssh -p 2222 -i ~/.ssh/id_ed25519 root@85.215.222.81 \
  "cd /opt/docker/pz-crcon && docker compose pull && docker compose up -d"
```

To run a fresh Prisma migration after a schema change:

```bash
ssh -p 2222 -i ~/.ssh/id_ed25519 root@85.215.222.81 \
  "docker exec -it pz-crcon npx prisma migrate deploy"
```

---

## 4. Troubleshooting

### Container won't start

```bash
docker logs pz-crcon --tail 200
```

Most common: a missing or invalid env var — the Zod `loadEnv()`
validator throws on the first request and the failure message lists
exactly what's wrong.

### `Sign in with Discord` redirects to an error page

Check that the Discord Developer Portal has **all** three redirect URIs
registered:

- `http://localhost:3000/api/auth/callback/discord` (local dev)
- `https://pz.majorluk.pl/api/auth/callback/discord` (prod)

Also verify `DISCORD_ADMIN_IDS` includes your numeric Discord user ID
(right-click your Discord avatar → "Copy User ID" with developer mode on).

### `/api/status` returns `online: false`

The container can't reach the PZ RCON socket. Verify:

```bash
docker exec -it pz-crcon nc -vz 85.215.222.81 27015
```

If it fails, the PZ server isn't listening or UFW is blocking port
27015 from the container's NAT egress. The bridge network egresses via
the host's external IP, so the PZ server must accept connections on its
public IP (per ADR 0001).

### NPM gives 502 / cannot resolve `pz-crcon`

The `pz-crcon` container has to share the `proxy-net` Docker network
with the NPM container. Verify with:

```bash
docker network inspect proxy-net | grep -E '"Name"|pz-crcon|nginx-proxy-manager'
```

If `pz-crcon` is missing, restart it: `docker compose up -d --force-recreate`.

### Prisma migrate hangs

The shared Postgres container may have rejected the connection — check
that `DATABASE_URL` uses the docker DNS name **`shared-postgres`**, not
`localhost`. Verify by exec-ing into the app container and running
`pg_isready -h shared-postgres -p 5432`.

### "Wipe world" fails with `data-path-not-writable`

Classic symptom of section 2.0(a) having been skipped: the `pz-data`
volume has some directories owned by `root:root`, so the container
user (uid 1000) can't create the `.trash-*` sibling during rename.
Fix on the PZ host (stop the server, chown, start):

```bash
docker stop pz-server
chown -R 1000:1000 /var/lib/docker/volumes/pz-data/_data
docker start pz-server
```

Same fix applies when config edits surface `config-dir-unreachable`
in `/admin/logs` — the writer calls `fs.access(W_OK)` on the config
dir at startup and caches the result.

### Portainer "Attach Console" on `pz-server` is blank

Upstream image needs a TTY. Add `tty: true` + `stdin_open: true` to
the `pz-server` service in
`/opt/docker/projectzomboid/docker-compose.yml`, then
`docker compose up -d pz-server` on the PZ host. Confirm with
`docker inspect pz-server --format '{{.Config.Tty}} {{.Config.OpenStdin}}'`
— both must report `true`.

### Watchtower didn't pick up the new image

```bash
docker logs watchtower --tail 50
```

Confirm the container has the label
`com.centurylinklabs.watchtower.enable=true` (it does, per the deploy
compose file). To force a poll: `docker exec watchtower /watchtower
--run-once pz-crcon`.

---

## 5. Rollback

If a release is broken:

```bash
ssh -p 2222 -i ~/.ssh/id_ed25519 root@85.215.222.81
cd /opt/docker/pz-crcon

# Pin to a known-good short-sha tag (see DockerHub for available tags)
sed -i 's|majorluk/pz-crcon:latest|majorluk/pz-crcon:<short-sha>|' docker-compose.yml
docker compose pull && docker compose up -d
```

Once a fix is merged, restore `:latest` and let Watchtower take over again.
