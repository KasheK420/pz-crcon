/**
 * Static tile server for self-hosted Project Zomboid map tiles.
 *
 * Reads PNG tiles from a filesystem directory (default `/pz-data/tiles`)
 * and streams them with long-lived cache headers. Used by the Leaflet
 * map component when the public `pzmap.crash-override.net` / `map.projectzomboid.com`
 * tile hosts are down (both were down and unreplaceable as of 2026-04).
 *
 * Tile pyramid generation lives outside the app: see
 * `docs/deployment/pz-map-tiles.md` for the `pzmap2dzi` workflow.
 *
 * No auth — tiles are as public as the map itself. No mutating
 * endpoints exist here.
 */
import { NextResponse } from "next/server";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join, normalize, sep } from "node:path";
import type { Readable } from "node:stream";
import { getLogger } from "@/lib/logger";

const log = () => getLogger().child({ mod: "api/tiles" });

const TILES_DIR = process.env.PZ_TILES_DIR ?? "/pz-data/tiles";

// One year — tiles are immutable once generated (a new generation would
// go under a different prefix like /api/tiles/knox-v2/...).
const CACHE_HEADER = "public, max-age=31536000, immutable";

const ALLOWED_EXT = new Set(["png", "jpg", "jpeg", "webp"]);

const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export const dynamic = "force-dynamic";

function safeJoin(base: string, parts: string[]): string | null {
  const joined = normalize(join(base, ...parts));
  const baseNormalized = normalize(base + sep);
  if (!joined.startsWith(baseNormalized)) return null;
  return joined;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const { path } = await ctx.params;
  if (!path || path.length === 0) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  for (const seg of path) {
    if (seg === "" || seg === "." || seg === "..") {
      return NextResponse.json({ error: "invalid path" }, { status: 400 });
    }
  }

  const last = path[path.length - 1];
  const extMatch = /\.([a-z0-9]+)$/i.exec(last);
  const ext = extMatch?.[1].toLowerCase() ?? "";
  if (!ALLOWED_EXT.has(ext)) {
    return NextResponse.json({ error: "unsupported extension" }, { status: 400 });
  }

  const abs = safeJoin(TILES_DIR, path);
  if (!abs) {
    log().warn({ requested: path.join("/") }, "tile path traversal blocked");
    return NextResponse.json({ error: "bad path" }, { status: 400 });
  }

  let size: number;
  try {
    const s = await stat(abs);
    if (!s.isFile()) {
      return NextResponse.json({ error: "not a file" }, { status: 404 });
    }
    size = s.size;
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const nodeStream = createReadStream(abs);
  const webStream = nodeReadableToWeb(nodeStream);

  return new NextResponse(webStream, {
    status: 200,
    headers: {
      "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream",
      "Content-Length": String(size),
      "Cache-Control": CACHE_HEADER,
    },
  });
}

function nodeReadableToWeb(src: Readable): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      src.on("data", (chunk: Buffer | string) => {
        controller.enqueue(
          typeof chunk === "string" ? Buffer.from(chunk) : chunk,
        );
      });
      src.on("end", () => controller.close());
      src.on("error", (err) => {
        log().warn({ msg: err.message }, "tile stream error");
        controller.error(err);
      });
    },
    cancel() {
      src.destroy();
    },
  });
}
