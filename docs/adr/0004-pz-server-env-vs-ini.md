# ADR 0004: pz-server env vars are the source of truth for mod lists, not the INI

## Status

Accepted — 2026-04-24.

## Context

pz-crcon's Mod Manager (`app/api/admin/mods/*`) writes `WorkshopItems=`
and `Mods=` directly into `Zomboid/Server/<prefix>.ini` via the atomic
writer. Every panel mod operation (add, enable/disable, reorder,
delete, import collection) runs through `syncIniFromDb()` which
rewrites those two lines from the Prisma `Mod` table.

This works while PZ is running. But the reference pz-server image
we deploy (`renegademaster/zomboid-dedicated-server`) ships an
entrypoint that **regenerates the INI from env vars on every container
start**:

```
MOD_WORKSHOP_IDS=<semicolon-list>   → written as WorkshopItems=
MOD_NAMES=<semicolon-list>          → written as Mods=
```

So any panel-written INI state is silently obliterated the next time
pz-server starts. Symptoms:

- Import a Workshop collection via `/admin/mods` → INI gets 83 entries.
- Restart pz-server via panel Server Controls → INI has the **old**
  env-derived 53 entries again. PZ dropped all 83 mods.
- No error surfaced to the operator; the Mods page shows "INI drift"
  after the restart.

The in-process `PzConfigSnapshot` / `restorePzConfig` dance in
`lib/server/lifecycle.ts` doesn't help — it only defends against PZ's
own save-on-quit rewriting the file; it runs **after** pz-server
stops but **before** it starts again, so the subsequent entrypoint
regeneration still overwrites the restored state.

## Decision

Treat the pz-server **`.env` file** as the source of truth for the
live mod list, not the INI. The panel remains the operator UI, but
when the operator clicks "Apply to INI" on `/admin/mods`, the
write path will (a) update the `Mod` table, (b) rewrite the INI
(so PZ picks up mid-session config reloads correctly), AND
(c) ALSO template and write `MOD_WORKSHOP_IDS=…` / `MOD_NAMES=…` into
the pz-server compose `.env` and recreate the container.

Interim (as of this ADR): the env write is **manual**. Operators
hitting the mod-list consistency issue run the helper described in
§"Runbook" below. A follow-up issue tracks automating step (c).

## Rationale

- Adding a "write to host `.env` + `docker compose up -d pz-server`"
  hook to the panel crosses a trust boundary — the socket proxy
  allowlist currently only permits `CONTAINERS_START/STOP/RESTART/KILL`,
  not image pulls or re-creation. Either expand the allowlist
  (larger attack surface) or split the write into an operator-side
  script (smaller blast radius). ADR defers this decision.
- Removing `MOD_*` env vars from the pz-server compose entirely would
  stop the regeneration, but also breaks every other operator who
  uses the reference image and expects env-driven init. We'd be
  forking the upstream workflow.
- Keeping the INI write in the panel is still valuable even without
  env sync — PZ supports `reloadoptions` RCON to pick up a subset of
  INI changes mid-session without a restart. Mods aren't in the
  reloadable set, but ServerWelcomeMessage etc. are.

## Consequences

- Until the follow-up lands, any time an operator imports a mod
  collection through the panel, they must also update
  `/opt/docker/projectzomboid/.env` and `docker compose up -d
  pz-server` on the host. Panel-only edits will be wiped by the
  next container recreate.
- "INI drift" on `/admin/mods` after a restart is not a panel bug —
  it's the env-regen footprint. The panel should label it explicitly
  rather than suggesting operators "Apply to INI" again (which fixes
  the symptom for one save cycle and reverts on next start).

## Runbook — sync DB to pz-server .env + recreate

```bash
# 1. Panel DB contains the desired mod list (edit via /admin/mods).
# 2. On the PZ host, extract DB values into files pz-crcon can read:
docker exec -i pz-crcon node -e '
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
p.mod.findMany({ where: { enabled: true }, orderBy: { loadOrder: "asc" } })
  .then(mods => {
    const ws = mods.filter(m => !m.workshopId.startsWith("local-"))
                   .map(m => m.workshopId).join(";");
    const names = mods.map(m => m.modId).join(";");
    require("fs").writeFileSync("/tmp/ws.txt", ws);
    require("fs").writeFileSync("/tmp/names.txt", names);
    console.log(`workshop=${ws.split(";").length} names=${names.split(";").length}`);
    return p.$disconnect();
  });
'
docker cp pz-crcon:/tmp/ws.txt    /tmp/ws.txt
docker cp pz-crcon:/tmp/names.txt /tmp/names.txt

# 3. Patch the env file (keeps other lines unchanged).
cp /opt/docker/projectzomboid/.env /opt/docker/projectzomboid/.env.bak-$(date +%s)
WS=$(cat /tmp/ws.txt); NAMES=$(cat /tmp/names.txt)
awk -v ws="$WS" -v names="$NAMES" '
  BEGIN{FS=OFS="="}
  /^MOD_WORKSHOP_IDS=/{ print "MOD_WORKSHOP_IDS=" ws; next }
  /^MOD_NAMES=/{ print "MOD_NAMES=" names; next }
  { print }
' /opt/docker/projectzomboid/.env > /tmp/new.env
mv /tmp/new.env /opt/docker/projectzomboid/.env

# 4. Recreate pz-server — entrypoint templates INI from new env.
cd /opt/docker/projectzomboid && docker compose up -d pz-server
```

After the recreate, PZ boots, templates INI with the 83+1 entries,
and starts downloading any Workshop items not yet on disk. The
panel's `/admin/mods` INI-drift banner disappears on the next tick.

## Follow-up

- Add a panel route `POST /api/admin/mods/apply-to-env` that does
  the above server-side, gated on OWNER + CSRF. Requires socket-proxy
  allowlist extension for `compose up -d` (or an HTTP-exposed
  helper shim on the host).
- Relabel the `/admin/mods` INI-drift banner to mention that panel-
  only edits don't survive a full recreate, and link to this ADR.
- Track upstream issue on the renegademaster image to expose a
  `SKIP_ONBOOT_INIT` env flag so operators can fully opt out of
  entrypoint regeneration.
