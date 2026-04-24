#!/usr/bin/env -S tsx
/**
 * scripts/import-collection.ts
 *
 * One-shot CLI wrapper around `importCollection()` for seeding / bulk
 * migrating a server's mod list from a Steam Workshop collection.
 *
 * Usage:
 *   tsx scripts/import-collection.ts <collectionId> [--replace]
 *
 * Example (in pz-crcon container):
 *   docker exec -it pz-crcon sh -c \\
 *     'cd /app && npx tsx scripts/import-collection.ts 3713221548 --replace'
 *
 * `--replace` wipes the existing `Mod` rows before importing. Without it,
 * the import is additive and skips duplicates. Always invokes
 * `syncIniFromDb()` at the end so `WorkshopItems=` / `Mods=` pick up the
 * new list immediately.
 */

import { importCollection } from "../lib/pz/mods";

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => a.length > 0);
  if (args.length === 0) {
    process.stderr.write(
      "usage: tsx scripts/import-collection.ts <collectionId> [--replace]\n",
    );
    process.exit(2);
  }
  const replace = args.includes("--replace");
  const collectionId = args.find((a) => !a.startsWith("--"));
  if (!collectionId) {
    process.stderr.write("error: missing collectionId\n");
    process.exit(2);
  }

  process.stderr.write(
    `[import] collection=${collectionId} replace=${replace}\n`,
  );
  const result = await importCollection({
    collectionId,
    replaceExisting: replace,
    applyToIni: true,
  });
  if (!result.ok) {
    process.stderr.write(`[import] failed: ${result.code} — ${result.detail}\n`);
    process.exit(1);
  }
  process.stderr.write(
    `[import] done. added=${result.addedCount} skipped=${result.skippedCount} failed=${result.failedCount} misses=${result.steamMisses.length} iniApplied=${result.iniApplied}\n`,
  );
  if (result.steamMisses.length > 0) {
    process.stderr.write(
      `[import] steam misses (stored as placeholders): ${result.steamMisses.join(",")}\n`,
    );
  }
  process.exit(0);
}

main().catch((e) => {
  process.stderr.write(
    `[import] uncaught: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`,
  );
  process.exit(1);
});
