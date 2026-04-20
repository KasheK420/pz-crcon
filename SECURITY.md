# Security Policy

## Supported Versions

As `pz-crcon` is pre-1.0, only the `main` branch receives security updates.

| Version | Supported          |
| ------- | ------------------ |
| `main`  | :white_check_mark: |
| < 0.1   | :x:                |

## Reporting a Vulnerability

**Please do not open public GitHub issues for security vulnerabilities.**

Report vulnerabilities privately via either:

1. **GitHub Security Advisory (preferred):**
   [Report a vulnerability](https://github.com/KasheK420/pz-crcon/security/advisories/new)
2. **Email:** `majoros.lukas@pm.me`

Please include:

- Description of the vulnerability
- Steps to reproduce
- Affected versions / commit SHAs
- Potential impact
- Any suggested fix

### What to expect

- **Acknowledgement:** within 72 hours
- **Initial assessment:** within 1 week
- **Fix timeline:** depends on severity (critical: days; low: weeks)
- **Credit:** reporters are credited in release notes unless they prefer to stay anonymous

## Scope

In scope:
- The `pz-crcon` web application (backend + frontend)
- The companion Lua mod
- Docker images and deployment configs
- Documentation that could lead to insecure deployments

Out of scope:
- Vulnerabilities in Project Zomboid itself (report to The Indie Stone)
- Vulnerabilities in third-party dependencies — please report upstream first, then let us know if we need to bump

## Hardening guidance

Users running `pz-crcon` in production should:

- Keep all services behind a firewall / VPN (Tailscale, Wireguard, etc.)
- Use strong, unique passwords for RCON, database, and admin accounts
- Enable TLS (Cloudflare Tunnel, Let's Encrypt, or reverse proxy termination)
- Keep Docker images up to date (Watchtower or similar)
- Regularly rotate the `MOD_WEBHOOK_TOKEN`
- Review admin action logs periodically

Deployment hardening docs will live in `docs/deployment/security.md`.

## Sensitive mounts

### `/var/run/docker.sock` (read-only)

As of Phase 1.5, the production compose file mounts the host Docker socket
into the `pz-crcon` container **read-only** (`:ro`). This is required for:

- `/api/admin/host-stats` — reads `containers/<name>/stats` for `pz-server`
  and `pz-crcon` to surface live memory + CPU on the admin overview.
- `/admin/logs` — streams `docker logs -f pz-server` over WebSocket
  (`logs:server` channel, MODERATOR+ role) into the admin log viewer.

**Threat model:**
- The Docker socket exposes the full Docker API, even when mounted `:ro`.
  The `:ro` flag prevents the container from modifying the socket file
  itself, but does **not** restrict the API operations that can be
  performed against the daemon.
- A compromised `pz-crcon` process could in principle list, inspect,
  exec into, or stop other containers on the same Docker daemon.
- We mitigate this by:
  1. The application code only ever calls non-mutating endpoints
     (`stats`, `logs`, `inspect`) via the `lib/docker/client.ts`
     wrapper. There is no `start`, `stop`, `exec`, `commit`, `kill`,
     or `remove` call anywhere in the codebase.
  2. The container runs as a non-root user (`pzcrcon`) — the socket
     must be readable by that user (`docker` group on the host).
  3. The admin panel itself is gated by Discord OAuth + an explicit
     `DISCORD_ADMIN_IDS` allowlist; no anonymous access.
  4. The host firewall (UFW) only exposes 80/443 and 2222/SSH publicly;
     the panel is reached via Cloudflare Tunnel, not a port-forward.

**If you do not need host-stats or live logs**, you can safely remove the
`/var/run/docker.sock:/var/run/docker.sock:ro` mount from
`docker/docker-compose.deploy.yml`. The endpoints will return
`{available: false}` and the log viewer will show "Docker socket
unavailable", but the rest of the app will continue to work.
