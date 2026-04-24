#!/usr/bin/env -S tsx
/**
 * scripts/register-local-mod.ts
 *
 * Register a *local* (non-Workshop) mod in the panel DB and sync the
 * server.ini `Mods=` line so PZ loads it on next restart. Used for
 * bundles shipped alongside the panel (the Phase 4 `PZCrcon`
 * companion), where there's no Steam Workshop ID yet.
 *
 * Usage:
 *   tsx scripts/register-local-mod.ts <modId> [<displayName>]
 *
 * The workshopId slot is synthesized as `local-<modId>` so the unique
 * index is respected. Running the script twice is a no-op.
 */

import { prisma } from "../lib/db/client";
import { checkConfigAccess } from "../lib/pz/access-check";
import { syncIniFromDb } from "../lib/pz/mods";

async function main(): Promise<void> {
  const modId = process.argv[2];
  const name = process.argv[3] ?? `${modId} (local)`;
  if (!modId || !/^[A-Za-z0-9_-]+$/.test(modId)) {
    process.stderr.write(
      "usage: tsx scripts/register-local-mod.ts <modId> [displayName]\n",
    );
    process.exit(2);
  }
  const workshopId = `local-${modId}`;
  const existing = await prisma.mod.findUnique({ where: { workshopId } });
  if (existing) {
    process.stderr.write(
      `[register-local-mod] ${modId} already registered (id=${existing.id}, loadOrder=${existing.loadOrder})\n`,
    );
  } else {
    const top = await prisma.mod.aggregate({ _max: { loadOrder: true } });
    const created = await prisma.mod.create({
      data: {
        workshopId,
        modId,
        name,
        enabled: true,
        loadOrder: (top._max.loadOrder ?? 0) + 1,
      },
    });
    process.stderr.write(
      `[register-local-mod] registered ${modId} id=${created.id} loadOrder=${created.loadOrder}\n`,
    );
  }

  // Prime the writer's access-check cache before the INI sync (fresh
  // tsx processes start with the flag unset — the running server has
  // it warm but we're a separate child here).
  const access = await checkConfigAccess();
  if (!access.ok) {
    process.stderr.write(
      `[register-local-mod] config dir not accessible: ${access.reason}\n`,
    );
    await prisma.$disconnect();
    process.exit(1);
  }
  const sync = await syncIniFromDb();
  if (!sync.ok) {
    process.stderr.write(
      `[register-local-mod] ini sync failed: ${sync.detail}\n`,
    );
    await prisma.$disconnect();
    process.exit(1);
  }
  process.stderr.write(
    `[register-local-mod] ini synced. Mods line now has the new entry — restart PZ to load.\n`,
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  process.stderr.write(
    `[register-local-mod] uncaught: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`,
  );
  process.exit(1);
});
