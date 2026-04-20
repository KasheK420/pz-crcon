# ADR 0001: pz-crcon uses bridge network and connects to PZ RCON via public IP

## Status
Accepted - 2026-04-20

## Context
PZ binds RCON only on the host's primary IP (85.215.222.81:27015),
not on 127.0.0.1. We tested this and the bind socket is [::ffff:85.215.222.81]:27015.
The pz-crcon Next.js container needs to reach RCON. Two options:
1. Run pz-crcon with network_mode: host (loopback works).
2. Run on the standard proxy-net + db-net bridge networks and connect
   to RCON via the host's public IP.

## Decision
Option 2: bridge network. The container connects to RCON_HOST=85.215.222.81.

## Rationale
- NPM proxy already routes via container DNS; host network would break that.
- Cloudflare Tunnel + NPM expects container hostnames, not host ports.
- Public IP loopback works because UFW filters external ingress, not local
  source traffic. Verified with the existing itzg/rcon container.
- Keeps pz-crcon's port surface clean (only WS/HTTP, no port-forwarding).

## Consequences
- RCON_HOST env defaults to the public IP, not 127.0.0.1.
- If the host changes its public IP (datacenter migration), update env.
- Marginal extra hop through the kernel routing table; negligible at our
  RCON volume (<10 cmd/s).

## Addendum (2026-04-20): WebSocket auth via cookie

The spec section 8 suggests client-sent `auth` frames. We instead read the
session cookie at the HTTP upgrade because:
- Browsers already authenticate cookies per-origin; no extra logic.
- WS handshake fails fast (no half-open authenticated socket).
- Removes session-token handling from React entirely.
Trade-off: WS-from-non-browser clients (e.g. CLI tools) need an API token
mechanism - added in Phase 2 alongside the `ApiToken` model.
