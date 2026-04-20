#!/usr/bin/env -S tsx
/**
 * scripts/sync-mods.ts
 *
 * Workshop metadata sync. Pulls Steam Workshop details for a set of
 * Project Zomboid Workshop IDs and upserts `Mod` rows in the DB.
 *
 * Usage:
 *   tsx scripts/sync-mods.ts                       # uses MOD_WORKSHOP_IDS env (CSV)
 *   tsx scripts/sync-mods.ts 3508537032,2904920097 # explicit CSV arg
 *   tsx scripts/sync-mods.ts 3508537032 2904920097 # space-separated args
 *
 * Inputs:
 *   - MOD_WORKSHOP_IDS env var (comma-separated, optional)
 *   - argv (CSV or whitespace-separated, optional)
 *   - DEFAULT_WORKSHOP_IDS hardcoded fallback (TEMPORARY: should be replaced
 *     by a proper mod-list source-of-truth, e.g. parsed straight from
 *     servertest_SandboxVars.lua or `WorkshopItems=` in the server INI).
 *
 * Steam Workshop API (anonymous, no API key needed for ISteamRemoteStorage):
 *   POST https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/
 *   form body: itemcount=N&publishedfileids[0]=...&publishedfileids[1]=...
 *
 * Effects (idempotent):
 *   - Upserts each Workshop ID into the Mod table by `workshopId`
 *   - Sets/refreshes `name`, `thumbnailUrl`, and `loadOrder` (preserving
 *     order of the input list so ModGrid renders in the same order)
 *   - Sets `enabled=true` and a sane fallback `modId` if Steam returns nothing
 */

import { PrismaClient } from "@prisma/client";

// TEMPORARY: replaces the one-off SQL seed. Once a real mod-list
// source-of-truth lands (e.g. reading WorkshopItems= from the PZ server INI),
// remove this list and have the script always read the env / arg input.
const DEFAULT_WORKSHOP_IDS: string[] = [
  // Phase 1 NeatUI seed — kept so a fresh DB has at least one row.
  "3508537032",
];

const STEAM_API_URL =
  "https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/";

const BATCH_SIZE = 100;

interface SteamWorkshopItem {
  publishedfileid: string;
  result: number;
  title?: string;
  preview_url?: string;
  filename?: string;
  time_updated?: number;
  time_created?: number;
}

interface SteamResponse {
  response?: {
    result?: number;
    resultcount?: number;
    publishedfiledetails?: SteamWorkshopItem[];
  };
}

function parseInputIds(): string[] {
  const args = process.argv.slice(2);

  // Handle CSV in either env or first arg
  const csvArgs = args.length === 1 && args[0].includes(",") ? args[0] : null;
  const fromArgs = csvArgs
    ? csvArgs.split(",")
    : args.length > 0
      ? args
      : null;
  const fromEnv = process.env.MOD_WORKSHOP_IDS
    ? process.env.MOD_WORKSHOP_IDS.split(",")
    : null;

  const list = fromArgs ?? fromEnv ?? DEFAULT_WORKSHOP_IDS;
  const cleaned = list
    .map((s) => s.trim())
    .filter((s) => /^[0-9]+$/.test(s));
  if (cleaned.length === 0) {
    throw new Error(
      "No workshop IDs provided (set MOD_WORKSHOP_IDS env or pass as args)."
    );
  }
  return Array.from(new Set(cleaned));
}

async function fetchBatch(ids: string[]): Promise<SteamWorkshopItem[]> {
  const body = new URLSearchParams();
  body.set("itemcount", String(ids.length));
  ids.forEach((id, i) => body.set(`publishedfileids[${i}]`, id));

  const res = await fetch(STEAM_API_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`Steam API returned HTTP ${res.status}`);
  }
  const json = (await res.json()) as SteamResponse;
  return json.response?.publishedfiledetails ?? [];
}

async function fetchAll(ids: string[]): Promise<SteamWorkshopItem[]> {
  const out: SteamWorkshopItem[] = [];
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    process.stderr.write(
      `[sync-mods] fetching batch ${i / BATCH_SIZE + 1} (${batch.length} ids)…\n`
    );
    const items = await fetchBatch(batch);
    out.push(...items);
  }
  return out;
}

function deriveModId(item: SteamWorkshopItem, fallbackId: string): string {
  // Steam's `filename` looks like `WorkshopUploads/<id>/mods/<ModId>/...`.
  // We can't reliably derive the in-game Mod ID from the workshop item
  // alone (a workshop bundle can contain multiple mods). Use the title
  // as a human-friendly id when present; otherwise the workshop id.
  if (item.title) {
    return item.title.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 64) || fallbackId;
  }
  return fallbackId;
}

async function main(): Promise<void> {
  const ids = parseInputIds();
  process.stderr.write(`[sync-mods] syncing ${ids.length} mods…\n`);

  const items = await fetchAll(ids);
  const byId = new Map<string, SteamWorkshopItem>();
  for (const it of items) byId.set(it.publishedfileid, it);

  const prisma = new PrismaClient();
  try {
    let okCount = 0;
    let missCount = 0;
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const item = byId.get(id);
      if (!item || item.result !== 1 || !item.title) {
        missCount++;
        process.stderr.write(`[sync-mods] miss: ${id} (no Steam result)\n`);
        // Still upsert minimal row so the workshop link works in the UI.
        await prisma.mod.upsert({
          where: { workshopId: id },
          update: { loadOrder: i + 1 },
          create: {
            workshopId: id,
            modId: id,
            name: `Workshop ${id}`,
            enabled: true,
            loadOrder: i + 1,
          },
        });
        continue;
      }
      const name = item.title!;
      const thumb = item.preview_url ?? null;
      const modId = deriveModId(item, id);
      await prisma.mod.upsert({
        where: { workshopId: id },
        update: { name, thumbnailUrl: thumb, loadOrder: i + 1, enabled: true },
        create: {
          workshopId: id,
          modId,
          name,
          thumbnailUrl: thumb,
          enabled: true,
          loadOrder: i + 1,
        },
      });
      okCount++;
    }
    process.stderr.write(
      `[sync-mods] done. ok=${okCount} miss=${missCount} total=${ids.length}\n`
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  process.stderr.write(`[sync-mods] failed: ${(e as Error).message}\n`);
  process.exit(1);
});
