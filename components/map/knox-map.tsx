"use client";

/**
 * Native Leaflet rendering of the Project Zomboid Knox County map.
 *
 * Tile servers (in fallback order):
 *   1. https://pzmap.crash-override.net/tiles/v0_unstable/B41/{z}/{x}/{y}.png
 *      — community-maintained, B41 unstable branch (matches our server).
 *   2. https://map.projectzomboid.com/tiles/{z}/{x}/{y}.png
 *      — TIS-hosted official map. Older content but reliable.
 *
 * If both fail (404 or network error), the layer is removed and a
 * "tiles unavailable" overlay is rendered on the otherwise-empty
 * Leaflet canvas — the marker layer still works in either case.
 *
 * We're guests on both tile hosts. If they go away, the long-term plan
 * is to render and self-host tiles via pzmap2dzi (Phase 2 task).
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
const PRIMARY_TILE_URL =
  "https://pzmap.crash-override.net/tiles/v0_unstable/B41/{z}/{x}/{y}.png";
const FALLBACK_TILE_URL = "https://map.projectzomboid.com/tiles/{z}/{x}/{y}.png";
const MIN_ZOOM = 0;
const MAX_ZOOM = 5;
const POLL_MS = 10_000;

function buildTileLayer(
  url: string,
  onAllErrored: () => void
): L.TileLayer & { _erroredOnce?: boolean } {
  const layer = L.tileLayer(url, {
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
    tileSize: 256,
    noWrap: true,
    attribution: "PZ tiles · pzmap community / TIS",
    crossOrigin: true,
  }) as L.TileLayer & { _erroredOnce?: boolean };
  let errorCount = 0;
  layer.on("tileerror", () => {
    errorCount++;
    // Treat repeated errors as "this server is down".
    if (errorCount >= 4 && !layer._erroredOnce) {
      layer._erroredOnce = true;
      onAllErrored();
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
  const [tilesAvailable, setTilesAvailable] = useState(true);
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

    function attachFallback() {
      if (!mapRef.current) return;
      // Remove primary layer if still attached, drop in fallback.
      if (tileLayerRef.current) {
        try {
          mapRef.current.removeLayer(tileLayerRef.current);
        } catch {
          // ignore
        }
      }
      const fallback = buildTileLayer(FALLBACK_TILE_URL, () => {
        // Both servers down — give up and show overlay.
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
      fallback.addTo(mapRef.current);
      tileLayerRef.current = fallback;
    }

    const primary = buildTileLayer(PRIMARY_TILE_URL, attachFallback);
    primary.addTo(map);
    tileLayerRef.current = primary;

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
          <div className="bg-pz-bg-0/85 border border-pz-border-lo px-4 py-3 text-pz-muted text-xs pz-mono">
            Map tiles unavailable. The community tile server appears to be
            down — markers continue to render.
          </div>
        </div>
      )}
    </div>
  );
}

export default KnoxMap;
