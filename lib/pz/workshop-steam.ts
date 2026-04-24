/**
 * Shared Steam Workshop metadata fetcher.
 *
 * Wraps the anonymous `ISteamRemoteStorage/GetPublishedFileDetails` endpoint
 * so both the `scripts/sync-mods.ts` CLI and the runtime Mod Manager API use
 * the exact same shape/error semantics.
 *
 * This endpoint is explicitly public (no API key), but it is rate-limited
 * per source IP. We batch up to 100 items per request and let callers retry
 * at their own cadence.
 */

const STEAM_API_URL =
  "https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/";

const STEAM_COLLECTION_URL =
  "https://api.steampowered.com/ISteamRemoteStorage/GetCollectionDetails/v1/";

const BATCH_SIZE = 100;

export interface WorkshopItem {
  publishedfileid: string;
  /** 1=OK, anything else = hidden/unlisted/removed */
  result: number;
  title?: string;
  description?: string;
  preview_url?: string;
  filename?: string;
  time_updated?: number;
  time_created?: number;
  /** Set by this module, not Steam. */
  ok: boolean;
}

interface SteamResponse {
  response?: {
    result?: number;
    resultcount?: number;
    publishedfiledetails?: Array<Omit<WorkshopItem, "ok">>;
  };
}

export function extractWorkshopId(input: string): string | null {
  const trimmed = input.trim();
  if (/^[0-9]+$/.test(trimmed)) return trimmed;
  // Accept any form of Workshop URL.
  const m = trimmed.match(/[?&]id=([0-9]+)/);
  if (m) return m[1];
  const m2 = trimmed.match(/\/filedetails\/(?:\?id=)?([0-9]+)/);
  if (m2) return m2[1];
  return null;
}

/**
 * Derive a stable "Mod ID" string from a workshop title.
 * PZ expects the in-game mod id (the folder name under `mods/`), which the
 * Workshop API doesn't return directly. We use a sanitised title as a
 * best-effort label — operators can override later if their mod bundle
 * publishes a different ID.
 */
export function deriveModId(title: string | undefined, fallback: string): string {
  if (!title) return fallback;
  const cleaned = title.replace(/[^A-Za-z0-9_]/g, "").slice(0, 64);
  return cleaned || fallback;
}

async function fetchBatch(ids: string[], signal?: AbortSignal): Promise<WorkshopItem[]> {
  const body = new URLSearchParams();
  body.set("itemcount", String(ids.length));
  ids.forEach((id, i) => body.set(`publishedfileids[${i}]`, id));

  const res = await fetch(STEAM_API_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal,
  });
  if (!res.ok) {
    throw new Error(`Steam API returned HTTP ${res.status}`);
  }
  const json = (await res.json()) as SteamResponse;
  const details = json.response?.publishedfiledetails ?? [];
  return details.map((d) => ({ ...d, ok: d.result === 1 }));
}

/**
 * Fetch Workshop metadata for one or more IDs. Returns in the same order
 * as the input. Items that Steam rejected (private / deleted / etc.) are
 * still returned but with `ok: false` so the caller can decide whether to
 * persist a placeholder row.
 */
export async function fetchWorkshopMeta(
  ids: string[],
  signal?: AbortSignal,
): Promise<WorkshopItem[]> {
  if (ids.length === 0) return [];
  const out: WorkshopItem[] = [];
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    const items = await fetchBatch(batch, signal);
    out.push(...items);
  }
  // Preserve request order (Steam returns them in order, but be defensive).
  const byId = new Map(out.map((it) => [it.publishedfileid, it]));
  return ids.map(
    (id) =>
      byId.get(id) ?? {
        publishedfileid: id,
        result: 0,
        ok: false,
      },
  );
}

export async function fetchOneWorkshopMeta(
  id: string,
  signal?: AbortSignal,
): Promise<WorkshopItem> {
  const [it] = await fetchWorkshopMeta([id], signal);
  return it;
}

interface CollectionChild {
  publishedfileid: string;
  sortorder?: number;
  filetype?: number;
}

interface CollectionDetailsResponse {
  response?: {
    result?: number;
    collectiondetails?: Array<{
      publishedfileid: string;
      result: number;
      children?: CollectionChild[];
    }>;
  };
}

export interface CollectionFetchResult {
  collectionId: string;
  childIds: string[];
}

/**
 * Fetch the child workshop IDs of a Steam Workshop *collection* (a bundle
 * that groups other workshop items). Used by the "import collection"
 * button in the mod manager.
 *
 * Collections nest — a collection's children may themselves be collections.
 * We do a single-level fetch: if any children are themselves collections,
 * they show up as IDs the caller can re-feed into this function.
 */
export async function fetchCollectionChildren(
  collectionId: string,
  signal?: AbortSignal,
): Promise<CollectionFetchResult> {
  const body = new URLSearchParams();
  body.set("collectioncount", "1");
  body.set("publishedfileids[0]", collectionId);
  const res = await fetch(STEAM_COLLECTION_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal,
  });
  if (!res.ok) {
    throw new Error(`Steam collection API returned HTTP ${res.status}`);
  }
  const json = (await res.json()) as CollectionDetailsResponse;
  const details = json.response?.collectiondetails?.[0];
  if (!details || details.result !== 1) {
    throw new Error(`collection ${collectionId} not accessible (result=${details?.result ?? "?"})`);
  }
  const childIds = (details.children ?? [])
    .slice()
    .sort((a, b) => (a.sortorder ?? 0) - (b.sortorder ?? 0))
    .map((c) => c.publishedfileid);
  return { collectionId, childIds };
}
