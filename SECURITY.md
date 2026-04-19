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
