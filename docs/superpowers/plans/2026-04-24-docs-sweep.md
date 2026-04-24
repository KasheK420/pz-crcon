# PZ-CRCON Docs Sweep — Catch-up

> Small self-contained plan executed alongside the gap analysis on
> 2026-04-24. Purpose: stop the docs from lying about shipped features.

**Scope:** every doc change tracked in §8 of
`docs/superpowers/plans/2026-04-24-gap-analysis.md`.

**Output:** no code changes, only `.md` and ADR files. Can ship independently
of any new feature.

---

## Tasks

- [ ] **README.md**
  - Bump status badge/line to **v0.2.0 / Phase 1.7 shipped**.
  - Move "visual config editor", "server lifecycle (start/stop/restart/abort/force-stop)", "reset-world / wipe", "audit trail", "CSRF-guarded mutations" from *Planned* to a new **Shipped** section.
  - Leave on the roadmap: mod manager UI, persistent logs viewer, player profile, backups, schedules, settings (Discord/users/tokens), Lua companion mod, live positions, public map overlays.
  - Redraw the architecture ASCII: show `docker-socket-proxy`, shared `pz-data` volume, NPM + Cloudflare Tunnel, and the Postgres instance.
  - Link the three new plans from §9 of the gap analysis.

- [ ] **CHANGELOG.md** [Unreleased]
  - Add a **Phase 1.7** subsection matching what actually shipped (config editor, lifecycle, audit, CSRF, docker-socket-proxy, writer, snapshot/restore, reset-world).
  - Move the existing 1.5/1.6 entries so phase order reads 1.5 → 1.6 → 1.7.
  - Prep an empty v0.3.0 section as "Phase 2 in progress" (mod manager / logs viewer / player profile).

- [ ] **docs/architecture.md**
  - Replace the Day-0 placeholder entirely.
  - Describe the real stack: Next 15 app + custom `server/ws.ts`, Postgres via Prisma, dockerode for reads, `docker-socket-proxy` for mutations, RCON to host IP, WebSocket channels (+ SSE in Phase 4), static Discord allowlist auth.
  - Section "Open decisions" goes away (all closed). Move it to a "Future decisions" callout pointing at Phase 4 ADRs.

- [ ] **docs/adr/**
  - New: `0002-docker-socket-proxy.md` — why we run tecnativa proxy with an allowlist instead of mounting the bare socket.
  - New: `0003-auth-allowlist-vs-guild.md` — why we dropped the original guild+bot auth from the spec and moved to `DISCORD_ADMIN_IDS`.
  - (Planned under Phase 4) `0004-sse-vs-ws-for-positions.md`, `0005-lua-hmac-scheme.md`.

- [ ] **docs/deployment.md**
  - Append §6 "Backup recovery" — finding `.bak-<iso>` files under the shared volume (Phase 1.7 writer output).
  - Append §7 "Audit log retention" — note `AuditEvent` has no retention job yet (Phase 3 scheduler will own it).
  - Append §8 "CSRF cookie rotation" — `NEXTAUTH_SECRET` rotation invalidates CSRF pair; ensure operators know to log users out before rotating.
  - Append §9 "Reset world runbook" — steps to trigger from `/admin/config` Danger Zone, and manual recovery from the `.trash-<iso>` dir if needed.

- [ ] **docs/superpowers/plans/index.md** (new, optional)
  - Simple table of all plans + their status.

- [ ] Add a short **Shipped vs Planned** matrix in `README.md` linking back to each plan file, so future contributors can see at a glance what's in-flight.

---

## Non-goal

No code changes. No new features. Strictly a documentation pass.
