#!/usr/bin/env -S tsx
/**
 * scripts/migrate-phase4.ts
 *
 * Idempotent additive migration that creates the tables introduced by the
 * Phase 4 backend drop:
 *
 *   - WorldEvent (live-map events from the Lua mod)
 *   - Setting    (KV store for Discord webhook + per-event rules)
 *
 * Uses `$executeRawUnsafe` so we don't need the Prisma migration engine
 * binary at runtime (the slim Alpine image only bundles the query engine).
 * Designed to be run via `docker exec pz-crcon npx tsx
 * scripts/migrate-phase4.ts`. Safe to re-run.
 *
 * Destructive cleanup of `SandboxOverride` + `ServerEvent` is NOT in this
 * script. Drop them manually when you're sure nothing else needs them.
 */

import { PrismaClient } from "@prisma/client";

const STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS "WorldEvent" (
     "id"       TEXT        PRIMARY KEY,
     "kind"     TEXT        NOT NULL,
     "player"   TEXT,
     "region"   TEXT,
     "x"        INTEGER,
     "y"        INTEGER,
     "z"        INTEGER,
     "day"      INTEGER,
     "metaJson" JSONB,
     "ts"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
   )`,
  `CREATE INDEX IF NOT EXISTS "WorldEvent_kind_ts_idx"   ON "WorldEvent" ("kind",   "ts")`,
  `CREATE INDEX IF NOT EXISTS "WorldEvent_player_ts_idx" ON "WorldEvent" ("player", "ts")`,

  `CREATE TABLE IF NOT EXISTS "Setting" (
     "key"       TEXT         PRIMARY KEY,
     "value"     JSONB        NOT NULL,
     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     "updatedBy" TEXT
   )`,
];

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    for (const sql of STATEMENTS) {
      process.stderr.write(
        `[migrate-phase4] executing: ${sql.replace(/\s+/g, " ").slice(0, 80)}…\n`,
      );
      await prisma.$executeRawUnsafe(sql);
    }
    // Sanity check — count rows in each new table so a failure here is
    // obvious rather than surfacing later in a 500 on /api/events.
    const worldCount = await prisma.worldEvent.count();
    const settingCount = await prisma.setting.count();
    process.stderr.write(
      `[migrate-phase4] done. WorldEvent rows=${worldCount}, Setting rows=${settingCount}\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  process.stderr.write(
    `[migrate-phase4] failed: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`,
  );
  process.exit(1);
});
