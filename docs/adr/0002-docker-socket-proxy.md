# ADR 0002: `tecnativa/docker-socket-proxy` for mutating Docker operations

## Status

Accepted — 2026-04-24 (shipped in Phase 1.7).

## Context

pz-crcon needs three capabilities against the host Docker daemon:

1. **Read-only inspection** — `docker inspect`, `docker stats`, `docker logs
   -f` for the host-stats card, startup-config page, and live log streamer.
2. **Mutating lifecycle control** — `docker start / stop / restart / kill`
   on the `pz-server` container for the Phase 1.7 lifecycle orchestrator.
3. **Reading the PZ container's file tree** — `docker exec pz-server cat
   <path>` for the config reader (sandbox vars, server.ini).

Mounting `/var/run/docker.sock` into a container is documented everywhere as
"the same as giving root on the host" — the Docker API exposes `exec`,
volumes, images, and networks, any of which defeats container isolation.
We deliberately want the panel to have less authority than "full Docker
daemon access" because the PZ server's world is on a shared volume and the
panel is internet-exposed.

Two sensible options:

- **A.** Mount the socket read-only and trust pz-crcon's own code to never
  call mutating endpoints. ("We just won't call `start`.")
- **B.** Run a sidecar that exposes the Docker API over TCP with an explicit
  allowlist of endpoints, and have pz-crcon talk to the sidecar.

## Decision

Option **B**: run [`tecnativa/docker-socket-proxy`][tsp] as a sidecar next
to pz-crcon. The proxy owns the raw `/var/run/docker.sock` (read-only) and
exposes an HTTP API on an internal-only Docker network
(`pz-control-net`). pz-crcon talks to it at `http://docker-socket-proxy:2375`.

Socket-proxy environment allowlist (compose):

```yaml
environment:
  CONTAINERS: 1           # GET containers
  POST: 1                 # allow POST (needed for the below)
  CONTAINERS_START: 1
  CONTAINERS_STOP: 1
  CONTAINERS_RESTART: 1
  CONTAINERS_KILL: 1
  EXEC: 0                 # explicitly DENY exec
  VOLUMES: 0
  NETWORKS: 0
  IMAGES: 0
  SYSTEM: 0
  INFO: 0
```

pz-crcon still mounts the raw socket read-only for reads (dockerode prefers
the socket path), while all mutations go through the TCP sidecar. See
`lib/docker/control.ts` for the split.

[tsp]: https://github.com/Tecnativa/docker-socket-proxy

## Rationale

- **Attack-surface reduction**: a compromised pz-crcon process cannot
  `docker exec` into any container — the proxy would 403. Same for
  volumes, images, and system-level calls.
- **Auditable contract**: the allowlist is a handful of env vars sitting
  next to the compose file. Reviewers can read a single `environment:`
  block to know exactly what pz-crcon is allowed to do to the host.
- **Defence in depth**: even if someone finds a bug in pz-crcon's own role
  check and triggers a stop on something unrelated, the proxy is the second
  line.
- **Ergonomic**: dockerode speaks the same HTTP protocol over a Unix socket
  or a TCP endpoint — we pass `host + port` for mutations and `socketPath`
  for reads with no other changes.
- **Read path unchanged**: `docker inspect`/`stats`/`logs` are cheap and
  high-volume; going through the proxy for every container stats tick would
  add 1 000+ extra HTTP round trips per hour for no safety gain (reads are
  already harmless).

## Consequences

- One extra container (`pz-crcon-socket-proxy`) in the stack, shared
  `pz-control-net` network.
- If the proxy goes down, the lifecycle controls return 503. Reads still
  work because they bypass the proxy.
- Operators must keep the allowlist in sync when new mutations are added.
  `lib/docker/control.ts` centralises the calls so missing allowlist entries
  surface as a single recognisable error shape.
- The proxy container itself runs `read_only: true` with tmpfs `/tmp` and
  `/run` (see compose), so a vulnerability in the proxy image can't
  persist.

## Consequences NOT accepted

- **Not used**: privileged: true, network_mode: host, or direct
  `:rw` socket mount. Those make the sidecar pointless.
- **Not used**: Docker API certificate-based auth. The sidecar is on a
  private Docker network that pz-crcon is the only member of, so TLS adds
  no value over the network boundary. If the topology changes (e.g.
  multiple panels sharing a proxy), revisit.
