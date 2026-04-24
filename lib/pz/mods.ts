/**
 * Mod Manager domain layer.
 *
 * Holds the business rules for adding / removing / toggling / reordering
 * the mods the PZ dedicated server should load. Single source of truth
 * is the Prisma `Mod` table; the server.ini `WorkshopItems=` and `Mods=`
 * keys are treated as a materialised view that we rewrite whenever the
 * DB changes.
 *
 * Flow for a user-initiated change:
 *   1. Mutate DB (add / remove / toggle / reorder).
 *   2. `syncIniFromDb()` assembles `WorkshopItems=` / `Mods=` strings
 *      from the enabled rows (ordered by loadOrder) and hands them to
 *      the existing atomic INI writer. Disabled rows are intentionally
 *      omitted from both lines — PZ cannot selectively disable, so
 *      "disabled" = "not in Mods= this boot".
 *   3. PZ requires a server restart before a new Mods= takes effect.
 *      This module does not restart — the caller surfaces a
 *      "requires restart" flag and the operator hits the Restart button.
 *
 * Failure modes are reported via typed unions instead of thrown errors
 * so the API layer can map them to the right HTTP status.
 */

import { prisma } from "@/lib/db/client";
import { getLogger } from "@/lib/logger";
import { readServerIni } from "./config-reader";
import { writeServerIni, type WriteOutcome } from "./writer";
import {
  deriveModId,
  extractWorkshopId,
  fetchCollectionChildren,
  fetchOneWorkshopMeta,
  fetchWorkshopMeta,
  type WorkshopItem,
} from "./workshop-steam";

const log = () => getLogger().child({ mod: "pz/mods" });

export interface ModRow {
  id: string;
  workshopId: string;
  modId: string;
  name: string;
  thumbnailUrl: string | null;
  version: string | null;
  enabled: boolean;
  loadOrder: number;
  installedAt: Date;
  updatedAt: Date;
}

export interface ModListResult {
  mods: ModRow[];
  /** Semicolon-joined lists that /should/ be in the INI for the current DB state. */
  expectedIniWorkshopItems: string;
  expectedIniMods: string;
  /** What's actually in the INI right now. */
  iniWorkshopItems: string | null;
  iniMods: string | null;
  iniPath: string;
  iniMtimeMs: number | null;
  /** True if the INI differs from the DB view (user hasn't applied yet). */
  iniDrift: boolean;
}

export type ModMutationFailure =
  | { ok: false; code: "invalid-input"; detail: string }
  | { ok: false; code: "duplicate"; detail: string }
  | { ok: false; code: "steam-unreachable"; detail: string }
  | { ok: false; code: "steam-rejected"; detail: string }
  | { ok: false; code: "not-found"; detail: string }
  | { ok: false; code: "ini-write"; detail: string; writerError?: WriteOutcome };

export type ModMutationOutcome =
  | { ok: true; mod: ModRow; iniApplied: boolean; requiresRestart: boolean }
  | ModMutationFailure;

export type ModBulkOutcome =
  | { ok: true; mods: ModRow[]; iniApplied: boolean; requiresRestart: boolean }
  | ModMutationFailure;

function toRow(m: {
  id: string;
  workshopId: string;
  modId: string;
  name: string;
  thumbnailUrl: string | null;
  version: string | null;
  enabled: boolean;
  loadOrder: number;
  installedAt: Date;
  updatedAt: Date;
}): ModRow {
  return {
    id: m.id,
    workshopId: m.workshopId,
    modId: m.modId,
    name: m.name,
    thumbnailUrl: m.thumbnailUrl,
    version: m.version,
    enabled: m.enabled,
    loadOrder: m.loadOrder,
    installedAt: m.installedAt,
    updatedAt: m.updatedAt,
  };
}

/**
 * Build the `WorkshopItems=` and `Mods=` strings PZ expects, from the
 * current DB state. Only enabled mods are included; disabled rows are
 * kept in the DB for history but removed from the server's live config.
 */
function assembleIniValues(mods: ModRow[]): {
  workshopItems: string;
  modsList: string;
} {
  const enabled = mods.filter((m) => m.enabled).sort((a, b) => a.loadOrder - b.loadOrder);
  const workshopItems = enabled.map((m) => m.workshopId).join(";");
  const modsList = enabled.map((m) => m.modId).join(";");
  return { workshopItems, modsList };
}

async function loadAll(): Promise<ModRow[]> {
  const rows = await prisma.mod.findMany({ orderBy: { loadOrder: "asc" } });
  return rows.map(toRow);
}

export async function listMods(): Promise<ModListResult> {
  const mods = await loadAll();
  const { workshopItems, modsList } = assembleIniValues(mods);
  const ini = await readServerIni();
  const iniWs = ini.ok ? (ini.parsed?.map?.WorkshopItems ?? "") : null;
  const iniM = ini.ok ? (ini.parsed?.map?.Mods ?? "") : null;
  const iniDrift =
    ini.ok && (iniWs ?? "") !== workshopItems ? true : ini.ok ? (iniM ?? "") !== modsList : false;
  return {
    mods,
    expectedIniWorkshopItems: workshopItems,
    expectedIniMods: modsList,
    iniWorkshopItems: iniWs,
    iniMods: iniM,
    iniPath: ini.path,
    iniMtimeMs: ini.ok ? (ini.mtimeMs ?? null) : null,
    iniDrift,
  };
}

/**
 * Write the current DB state to server.ini. Reads the current file
 * mtime first so the underlying writer doesn't fire the mtime-race
 * check against a stale value. Safe to call when the server is running
 * — PZ won't re-read the file until it restarts.
 */
export async function syncIniFromDb(): Promise<{
  ok: true;
  writtenMtimeMs: number;
  workshopItems: string;
  modsList: string;
} | { ok: false; code: "ini-write"; detail: string; writerError?: WriteOutcome }> {
  const ini = await readServerIni();
  if (!ini.ok || ini.mtimeMs === undefined) {
    return {
      ok: false,
      code: "ini-write",
      detail: `could not read current ini: ${ini.error ?? "unknown"}`,
    };
  }
  const mods = await loadAll();
  const { workshopItems, modsList } = assembleIniValues(mods);
  const priorValues: Record<string, string> = {
    WorkshopItems: ini.parsed?.map?.WorkshopItems ?? "",
    Mods: ini.parsed?.map?.Mods ?? "",
  };
  const patch = {
    WorkshopItems: workshopItems,
    Mods: modsList,
  };
  const result = await writeServerIni(patch, {
    clientMtimeMs: ini.mtimeMs,
    priorValues,
  });
  if (!result.ok) {
    log().warn({ code: result.code, detail: result.detail }, "mods: ini sync failed");
    return {
      ok: false,
      code: "ini-write",
      detail: `writer refused patch: ${result.code} (${result.detail})`,
      writerError: result,
    };
  }
  log().info({ mods: mods.length, workshopItems, modsList }, "mods: ini synced");
  return {
    ok: true,
    writtenMtimeMs: result.newMtimeMs,
    workshopItems,
    modsList,
  };
}

async function nextLoadOrder(): Promise<number> {
  const top = await prisma.mod.aggregate({ _max: { loadOrder: true } });
  return (top._max.loadOrder ?? 0) + 1;
}

function buildRow(
  workshopId: string,
  item: WorkshopItem | null,
): {
  workshopId: string;
  modId: string;
  name: string;
  thumbnailUrl: string | null;
  version: string | null;
} {
  const title = item?.title;
  const modId = deriveModId(title, workshopId);
  const name = title ?? `Workshop ${workshopId}`;
  const thumbnailUrl = item?.preview_url ?? null;
  return {
    workshopId,
    modId,
    name,
    thumbnailUrl,
    version: null,
  };
}

/**
 * Add a single mod by Workshop ID, URL, or raw numeric string.
 * Fetches Steam metadata (best-effort: a deleted/private mod still
 * persists a placeholder row so the operator can fix it later) and
 * then syncs the INI if `applyToIni` is true.
 */
export async function addMod(
  input: string,
  opts: { applyToIni?: boolean } = {},
): Promise<ModMutationOutcome> {
  const workshopId = extractWorkshopId(input);
  if (!workshopId) {
    return {
      ok: false,
      code: "invalid-input",
      detail: "expected a numeric Workshop ID or a Steam Workshop URL",
    };
  }
  const existing = await prisma.mod.findUnique({ where: { workshopId } });
  if (existing) {
    return {
      ok: false,
      code: "duplicate",
      detail: `${workshopId} is already installed`,
    };
  }

  let meta: WorkshopItem | null = null;
  try {
    meta = await fetchOneWorkshopMeta(workshopId);
  } catch (e) {
    // Steam API unreachable — accept the add with a placeholder row so
    // the operator isn't blocked by transient network issues.
    log().warn({ err: e, workshopId }, "mods: steam fetch failed, persisting placeholder");
    meta = null;
  }

  const row = buildRow(workshopId, meta);
  const loadOrder = await nextLoadOrder();
  const created = await prisma.mod.create({
    data: {
      workshopId,
      modId: row.modId,
      name: row.name,
      thumbnailUrl: row.thumbnailUrl,
      version: row.version,
      enabled: true,
      loadOrder,
    },
  });

  let iniApplied = false;
  if (opts.applyToIni !== false) {
    const sync = await syncIniFromDb();
    if (!sync.ok) {
      return { ...sync };
    }
    iniApplied = true;
  }
  return {
    ok: true,
    mod: toRow(created),
    iniApplied,
    requiresRestart: iniApplied,
  };
}

export async function removeMod(
  id: string,
  opts: { applyToIni?: boolean } = {},
): Promise<ModMutationOutcome> {
  const existing = await prisma.mod.findUnique({ where: { id } });
  if (!existing) {
    return { ok: false, code: "not-found", detail: `no mod with id=${id}` };
  }
  await prisma.mod.delete({ where: { id } });
  let iniApplied = false;
  if (opts.applyToIni !== false) {
    const sync = await syncIniFromDb();
    if (!sync.ok) return { ...sync };
    iniApplied = true;
  }
  return {
    ok: true,
    mod: toRow(existing),
    iniApplied,
    requiresRestart: iniApplied && existing.enabled,
  };
}

export async function toggleMod(
  id: string,
  enabled: boolean,
  opts: { applyToIni?: boolean } = {},
): Promise<ModMutationOutcome> {
  const existing = await prisma.mod.findUnique({ where: { id } });
  if (!existing) {
    return { ok: false, code: "not-found", detail: `no mod with id=${id}` };
  }
  const updated = await prisma.mod.update({
    where: { id },
    data: { enabled },
  });
  let iniApplied = false;
  if (opts.applyToIni !== false) {
    const sync = await syncIniFromDb();
    if (!sync.ok) return { ...sync };
    iniApplied = true;
  }
  return {
    ok: true,
    mod: toRow(updated),
    iniApplied,
    requiresRestart: iniApplied,
  };
}

export async function updateModDetails(
  id: string,
  patch: { modId?: string; name?: string },
  opts: { applyToIni?: boolean } = {},
): Promise<ModMutationOutcome> {
  const existing = await prisma.mod.findUnique({ where: { id } });
  if (!existing) {
    return { ok: false, code: "not-found", detail: `no mod with id=${id}` };
  }
  if (patch.modId && !/^[A-Za-z0-9_-]+$/.test(patch.modId)) {
    return {
      ok: false,
      code: "invalid-input",
      detail: "modId must only contain letters, digits, underscore or hyphen",
    };
  }
  const updated = await prisma.mod.update({
    where: { id },
    data: {
      ...(patch.modId !== undefined ? { modId: patch.modId } : {}),
      ...(patch.name !== undefined ? { name: patch.name } : {}),
    },
  });
  let iniApplied = false;
  if (opts.applyToIni !== false && patch.modId !== undefined) {
    const sync = await syncIniFromDb();
    if (!sync.ok) return { ...sync };
    iniApplied = true;
  }
  return {
    ok: true,
    mod: toRow(updated),
    iniApplied,
    requiresRestart: iniApplied,
  };
}

/**
 * Bulk reorder via a full list of IDs in the desired order. Any mod
 * not in the list keeps its previous loadOrder (moved to the end in
 * insertion order), so partial reorders are safe.
 */
export async function reorderMods(
  orderedIds: string[],
  opts: { applyToIni?: boolean } = {},
): Promise<ModBulkOutcome> {
  const all = await loadAll();
  const byId = new Map(all.map((m) => [m.id, m]));
  const missing = orderedIds.find((id) => !byId.has(id));
  if (missing) {
    return {
      ok: false,
      code: "not-found",
      detail: `id=${missing} not in mod list`,
    };
  }
  const tail = all.filter((m) => !orderedIds.includes(m.id)).map((m) => m.id);
  const ordered = [...orderedIds, ...tail];
  await prisma.$transaction(
    ordered.map((id, index) =>
      prisma.mod.update({ where: { id }, data: { loadOrder: index + 1 } }),
    ),
  );
  let iniApplied = false;
  if (opts.applyToIni !== false) {
    const sync = await syncIniFromDb();
    if (!sync.ok) return { ...sync };
    iniApplied = true;
  }
  const refreshed = await loadAll();
  return {
    ok: true,
    mods: refreshed,
    iniApplied,
    requiresRestart: iniApplied,
  };
}

export type BulkImportResult =
  | {
      ok: true;
      replaced: boolean;
      addedCount: number;
      skippedCount: number;
      failedCount: number;
      workshopIds: string[];
      steamMisses: string[];
      iniApplied: boolean;
      requiresRestart: boolean;
    }
  | ModMutationFailure;

/**
 * Replace the current mod list with the contents of a Steam Workshop
 * collection (single-level — nested collections are imported as their
 * own rows and can be expanded separately).
 *
 * `replaceExisting: true` deletes every mod row first. Use when the
 * operator explicitly wants "adopt this collection as my entire mod
 * list" — typical for the "ship a curated collection" flow. Setting
 * it to `false` does an additive merge (new IDs appended, existing
 * kept in place).
 */
export async function importCollection(args: {
  collectionId: string;
  replaceExisting: boolean;
  applyToIni?: boolean;
}): Promise<BulkImportResult> {
  const { collectionId, replaceExisting } = args;
  const cleaned = extractWorkshopId(collectionId);
  if (!cleaned) {
    return {
      ok: false,
      code: "invalid-input",
      detail: "expected a collection Workshop ID or URL",
    };
  }
  let childIds: string[];
  try {
    const col = await fetchCollectionChildren(cleaned);
    childIds = col.childIds;
  } catch (e) {
    return {
      ok: false,
      code: "steam-unreachable",
      detail: e instanceof Error ? e.message : String(e),
    };
  }
  if (childIds.length === 0) {
    return {
      ok: false,
      code: "steam-rejected",
      detail: `collection ${cleaned} has no child items`,
    };
  }

  // Fetch item metadata in one batch call.
  let items: WorkshopItem[] = [];
  try {
    items = await fetchWorkshopMeta(childIds);
  } catch (e) {
    return {
      ok: false,
      code: "steam-unreachable",
      detail: e instanceof Error ? e.message : String(e),
    };
  }
  const byId = new Map(items.map((i) => [i.publishedfileid, i]));

  if (replaceExisting) {
    await prisma.mod.deleteMany({});
  }

  let addedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  const steamMisses: string[] = [];

  // Determine starting loadOrder — in replace mode it's 1, otherwise
  // continue from current max + 1.
  let order = replaceExisting ? 1 : await nextLoadOrder();

  for (const workshopId of childIds) {
    const item = byId.get(workshopId);
    if (!item || !item.ok) {
      steamMisses.push(workshopId);
    }
    const row = buildRow(workshopId, item ?? null);
    try {
      const existing = await prisma.mod.findUnique({ where: { workshopId } });
      if (existing) {
        skippedCount++;
        continue;
      }
      await prisma.mod.create({
        data: {
          workshopId,
          modId: row.modId,
          name: row.name,
          thumbnailUrl: row.thumbnailUrl,
          version: row.version,
          enabled: true,
          loadOrder: order++,
        },
      });
      addedCount++;
    } catch (e) {
      failedCount++;
      log().warn(
        { workshopId, err: e instanceof Error ? e.message : String(e) },
        "mods: import row failed",
      );
    }
  }

  let iniApplied = false;
  if (args.applyToIni !== false) {
    const sync = await syncIniFromDb();
    if (!sync.ok) {
      return { ...sync };
    }
    iniApplied = true;
  }

  return {
    ok: true,
    replaced: replaceExisting,
    addedCount,
    skippedCount,
    failedCount,
    workshopIds: childIds,
    steamMisses,
    iniApplied,
    requiresRestart: iniApplied && addedCount > 0,
  };
}

/**
 * Refresh Steam metadata (name, thumbnail) for every mod in the DB.
 * Does not touch enable/loadOrder state. Useful after a long outage
 * or when a mod author republishes with new artwork.
 */
export async function refreshModMetaFromSteam(): Promise<
  | { ok: true; refreshed: number; missed: number }
  | { ok: false; code: "steam-unreachable"; detail: string }
> {
  const rows = await loadAll();
  if (rows.length === 0) return { ok: true, refreshed: 0, missed: 0 };
  let items: WorkshopItem[];
  try {
    items = await fetchWorkshopMeta(rows.map((r) => r.workshopId));
  } catch (e) {
    return {
      ok: false,
      code: "steam-unreachable",
      detail: e instanceof Error ? e.message : String(e),
    };
  }
  const byId = new Map(items.map((i) => [i.publishedfileid, i]));
  let refreshed = 0;
  let missed = 0;
  for (const row of rows) {
    const it = byId.get(row.workshopId);
    if (!it || !it.ok || !it.title) {
      missed++;
      continue;
    }
    await prisma.mod.update({
      where: { id: row.id },
      data: {
        name: it.title,
        thumbnailUrl: it.preview_url ?? null,
      },
    });
    refreshed++;
  }
  return { ok: true, refreshed, missed };
}
