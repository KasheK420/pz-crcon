# ADR 0003: Discord-ID allowlist instead of guild-membership + bot auth

## Status

Accepted — 2026-04-24.

## Context

The original `pz-crcon` design spec (`docs/superpowers/specs/2026-04-20-pz-crcon-design.md`)
proposed Discord auth via a bot:

- Panel logs in with Discord OAuth.
- On sign-in, the panel checks that the Discord user is a member of a
  specific guild and has a specific role.
- Role mapping in panel (OWNER/ADMIN/MODERATOR/VIEWER) is derived from the
  guild roles.

This is the HLL-CRCON playbook and it's fine for teams of 20+ operators
where "being in the guild" is the unit of trust. For pz-crcon today, the
practical operator set is 1–5 people — us and a couple of trusted friends.

The bot path has operational costs we don't want:

- Need a Discord app *with a bot token* (not just OAuth), and the token
  must stay valid across redeploys.
- The bot must be invited to the guild — friction when a new operator has
  their own server.
- Guild / role lookups require at least one authenticated API call per
  sign-in (Discord rate-limits sign-in storms).
- The panel now has a second secret (`DISCORD_BOT_TOKEN`) that needs to be
  rotated and secured.
- On a brand-new server, "first boot" is ambiguous — you need a guild and
  a role to exist before anyone can sign in.

## Decision

Replace the guild+bot mechanism with a **static Discord user-ID
allowlist**, sourced from a single env var:

```
DISCORD_ADMIN_IDS=<ownerId>,<adminId1>,<adminId2>,...
```

- The first ID in the list becomes **OWNER** on first login.
- Every subsequent ID becomes **ADMIN** on first login.
- Anyone whose Discord ID is not in the list is rejected at the OAuth
  `signIn` callback with a 403.
- There is no bot, no guild check, no Discord API call beyond the OAuth
  exchange that NextAuth already does.

`next-auth` version-5's `signIn` callback does the allowlist check; see
`lib/auth/config.ts`.

Role promotion/demotion beyond OWNER/ADMIN (e.g. MODERATOR, VIEWER for
trusted-but-not-admin viewers) is handled via Phase 3's settings → users
tab, which writes directly to the `User.role` column in the panel's
Postgres — never back-filled from Discord.

## Rationale

- **Zero bot footprint**: no bot token to rotate, no guild to manage. First
  deploy works in five minutes: set the env var, sign in.
- **Auditable trust boundary**: "who can log in" is one line in the env
  file. A git log of deploys tells the full access history.
- **Idempotent**: if an ID is removed from the env var and redeployed, the
  next sign-in returns 403. The already-promoted `User` row remains in the
  DB but has no way to get a session, so effective access is revoked. A
  future hygiene job (Phase 3 settings) can prune orphan `User` rows.
- **Doesn't preclude the richer model**: nothing in the Phase 4 webhook /
  live map / schedules flows needs Discord roles; if a future multi-tenant
  deployment grows into wanting guild auth, the `User` table already has a
  per-user `role` column and `next-auth` supports multiple providers side
  by side.

## Consequences

- Operators must find their own Discord ID (Settings → Advanced → Copy
  User ID in Discord). Documented in README + deployment.md.
- Removing someone's access requires editing the env var and redeploying
  the container. For small teams this is a feature; for 50+ operators it
  would be a papercut.
- There's no Discord slash-command admin surface (e.g. `/kick @player` from
  Discord) because there's no bot. If we want this later, it is a separate
  spec with its own trust model.
- Users promoted to higher roles via the Phase 3 settings UI **exceed**
  what the env var says. This is intentional: the env var controls
  *admission*, not the complete role graph. If you want to hard-cap
  someone at VIEWER regardless of in-panel promotions, don't list them.

## Alternatives considered

- **OAuth + Discord guild membership check (original spec)** — rejected for
  the reasons above (bot maintenance burden, extra secret, first-boot
  chicken-and-egg).
- **Email magic links** — doesn't match the community-managed-by-Discord
  model; also introduces SMTP as a new required dependency.
- **Single shared password** — would be simpler than OAuth, but the owner
  set grows slowly and sharing passwords across operators is a known
  incident risk.
- **Multi-allowlist (roles via env)** — e.g. `DISCORD_OWNER_IDS`,
  `DISCORD_ADMIN_IDS`, `DISCORD_MODERATOR_IDS`. Rejected for now: roles
  change more often than the allowlist itself, so it's cleaner to let the
  panel UI own role changes post-admission.
