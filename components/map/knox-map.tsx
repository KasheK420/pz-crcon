"use client";

/**
 * Native Leaflet rendering of the Project Zomboid Knox County map.
 *
 * Tile source is configured via the `NEXT_PUBLIC_PZ_TILE_URL` env var,
 * which is a Leaflet template string containing `{z}/{x}/{y}` (or
 * `{z}/{x}_{y}` for DZI-style layouts). Example values:
 *
 *   /api/tiles/knox/{z}/{x}_{y}.png   (self-hosted, DZI output from pzmap2dzi)
 *   /api/tiles/knox/{z}/{x}/{y}.png   (self-hosted, Leaflet/XYZ style)
 *
 * When the variable is unset we skip attaching any tile layer at all
 * and render a "tiles unavailable" overlay directly — the old public
 * community tile hosts (pzmap.crash-override.net, map.projectzomboid.com)
 * both went down / CORS-blocked in 2026-04 and we no longer attempt them.
 * Player markers render in either case.
 *
 * Generation pipeline: see `docs/deployment/pz-map-tiles.md`.
 *
 * World coordinates: Knox County extent is approximately 0,0 → 10224,10576.
 * We use Leaflet CRS.Simple so x and y are in tile-world space directly.
 *
 * Positions endpoint: /api/players/positions returns RCON-derived names
 * with placeholder coordinates until the Phase 4 Lua mod ships real ones.
 */

import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

interface Pos {
  name: string;
  x: number;
  y: number;
  approximate: boolean;
}

interface PositionsResponse {
  online: boolean;
  count: number;
  positions: Pos[];
  ts: number;
}

const WORLD_W = 10224;
const WORLD_H = 10576;

// Tile configuration (all optional, read at module scope so webpack inlines
// them into the client bundle at build time).
const TILE_URL = process.env.NEXT_PUBLIC_PZ_TILE_URL ?? "";
const TILE_SIZE = Number(process.env.NEXT_PUBLIC_PZ_TILE_SIZE ?? 256);
const MIN_ZOOM = Number(process.env.NEXT_PUBLIC_PZ_MIN_ZOOM ?? 0);
const MAX_ZOOM = Number(process.env.NEXT_PUBLIC_PZ_MAX_ZOOM ?? 5);
const POLL_MS = 10_000;

// Fail the tile layer fast: two tileerror events are enough to decide the
// server is unreachable. Leaflet fires many tileerrors in parallel, so a
// lower threshold keeps the console clean.
const TILE_ERROR_THRESHOLD = 2;

function buildTileLayer(
  url: string,
  onFailed: () => void,
): L.TileLayer & { _failed?: boolean } {
  const layer = L.tileLayer(url, {
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
    tileSize: TILE_SIZE,
    noWrap: true,
    attribution: "PZ tiles · self-hosted",
    crossOrigin: true,
  }) as L.TileLayer & { _failed?: boolean };
  let errorCount = 0;
  layer.on("tileerror", () => {
    errorCount++;
    if (errorCount >= TILE_ERROR_THRESHOLD && !layer._failed) {
      layer._failed = true;
      onFailed();
    }
  });
  return layer;
}

function makePlayerIcon(approximate: boolean): L.DivIcon {
  return L.divIcon({
    className: "pz-player-marker",
    html: `<div style="
      width:14px;height:14px;border-radius:50%;
      background:${approximate ? "rgba(212,160,23,0.9)" : "rgba(125,163,72,0.95)"};
      border:2px solid #07080a;
      box-shadow:0 0 6px rgba(125,163,72,0.6);
      "></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

export function KnoxMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const markerLayerRef = useRef<L.LayerGroup | null>(null);
  // Start optimistic only when a tile URL is configured; otherwise we
  // immediately render the "tiles unavailable" overlay and skip all
  // network tile loads (no external hosts, no console spam).
  const [tilesAvailable, setTilesAvailable] = useState(Boolean(TILE_URL));
  const [stale, setStale] = useState(false);
  const [positions, setPositions] = useState<Pos[]>([]);
  const [online, setOnline] = useState(false);

  // ---- Map init (run once) -----------------------------------------------
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const bounds = L.latLngBounds([0, 0], [WORLD_H, WORLD_W]);

    const map = L.map(containerRef.current, {
      crs: L.CRS.Simple,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      zoomControl: true,
      attributionControl: true,
      maxBounds: bounds.pad(0.5),
    });
    map.fitBounds(bounds);
    mapRef.current = map;

    if (TILE_URL) {
      const tiles = buildTileLayer(TILE_URL, () => {
        if (tileLayerRef.current && mapRef.current) {
          try {
            mapRef.current.removeLayer(tileLayerRef.current);
          } catch {
            // ignore
          }
          tileLayerRef.current = null;
        }
        setTilesAvailable(false);
      });
      tiles.addTo(map);
      tileLayerRef.current = tiles;
    }

    markerLayerRef.current = L.layerGroup().addTo(map);

    return () => {
      map.remove();
      mapRef.current = null;
      tileLayerRef.current = null;
      markerLayerRef.current = null;
    };
  }, []);

  // ---- Positions polling -------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/players/positions", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = (await res.json()) as PositionsResponse;
        if (cancelled) return;
        setPositions(j.positions ?? []);
        setOnline(Boolean(j.online));
        setStale(false);
      } catch {
        if (!cancelled) setStale(true);
      }
    }
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // ---- Render markers ----------------------------------------------------
  useEffect(() => {
    const layer = markerLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    // Group by integer coord cell so co-located players stack with offset.
    const buckets = new Map<string, Pos[]>();
    for (const p of positions) {
      const key = `${Math.round(p.x)}:${Math.round(p.y)}`;
      const arr = buckets.get(key) ?? [];
      arr.push(p);
      buckets.set(key, arr);
    }
    for (const [, arr] of buckets) {
      arr.forEach((p, i) => {
        // Spiral offset so overlapping placeholder markers don't completely
        // hide each other. ~80 world units between rings.
        const angle = (i / Math.max(1, arr.length)) * Math.PI * 2;
        const radius = i === 0 ? 0 : 80 + Math.floor(i / 8) * 60;
        const ox = Math.cos(angle) * radius;
        const oy = Math.sin(angle) * radius;
        // CRS.Simple -> latLng(y, x)
        const m = L.marker([p.y + oy, p.x + ox], {
          icon: makePlayerIcon(p.approximate),
          title: p.name,
        }).bindTooltip(p.name, {
          permanent: false,
          direction: "top",
          offset: [0, -8],
        });
        layer.addLayer(m);
      });
    }
  }, [positions]);

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="absolute inset-0 bg-pz-bg-deep" />

      {/* Status pill: bottom-right */}
      <div className="absolute bottom-3 right-3 z-[401] flex flex-col items-end gap-1">
        <span
          className={`pz-pill ${online ? "live" : ""}`}
          style={{ fontSize: 10, padding: "2px 8px" }}
        >
          {online ? `${positions.length} ONLINE` : "RCON OFFLINE"}
        </span>
        {stale && (
          <span
            className="pz-pill"
            style={{ fontSize: 10, padding: "2px 8px" }}
          >
            POSITIONS STALE
          </span>
        )}
      </div>

      {/* Phase 4 overlay (bottom-left) */}
      <div className="absolute bottom-3 left-3 z-[401] max-w-[320px] bg-pz-bg-0/85 border border-pz-border-lo px-2.5 py-1.5 pz-mono text-[10px] text-pz-text-dim leading-tight">
        Live positions require the PZCrcon Lua mod (Phase 4). Until then,
        player names are listed at a placeholder location.
      </div>

      {!tilesAvailable && (
        <div className="absolute inset-0 z-[400] grid place-items-center pointer-events-none">
          <div className="bg-pz-bg-0/85 border border-pz-border-lo px-4 py-3 text-pz-muted text-xs pz-mono max-w-[420px] text-center leading-relaxed">
            {TILE_URL
              ? "Map tiles unavailable. The tile server appears to be down — markers continue to render."
              : "Map tiles not configured. Generate a tile pyramid with pzmap2dzi and set NEXT_PUBLIC_PZ_TILE_URL — see docs/deployment/pz-map-tiles.md. Player markers still render."}
          </div>
        </div>
      )}
    </div>
  );
}

export default KnoxMap;
