# Self-hosted Project Zomboid map tiles

## Why

Both public Knox County tile hosts that `pz-crcon` used to fall back on
are effectively dead as of 2026-04:

- `pzmap.crash-override.net` — SSL cert expired / common-name mismatch
  (`ERR_CERT_COMMON_NAME_INVALID`).
- `map.projectzomboid.com/tiles/{z}/{x}/{y}.png` — returns 404 and
  sends no `Access-Control-Allow-Origin` header, so the browser blocks
  the responses anyway.

To keep the in-app map working we generate the tile pyramid ourselves
(once per PZ version bump) and serve the PNGs from the `pz-crcon`
container via `/api/tiles/*`.

## One-time pipeline overview

```
Windows PC (has PZ installed)
└─ pzmap2dzi  ──►  html/map_data/<base>/base_top/
                   └── {level}/{col}_{row}.png           (DZI pyramid)
                                │
                                ▼  rsync/scp
HomePL server
└─ /var/lib/docker/volumes/pz-data/_data/tiles/knox/
                                │
                                ▼  bind-mounted into container at /pz-data/tiles
pz-crcon container
└─ GET /api/tiles/knox/{z}/{x}_{y}.png  ──►  Leaflet client
```

## Step 1 — generate tiles locally

You need a Windows box with Project Zomboid installed. The renderer is
Python but ships as a Windows-first toolchain.

```powershell
# 1. Clone the renderer
cd $HOME\source
git clone https://github.com/cff29546/pzmap2dzi.git
cd pzmap2dzi

# 2. Install deps (requires Python 3.11+)
.\install_requirements.bat

# 3. Configure paths
notepad .\conf\conf.yaml
#   pz_root:      'C:\Program Files (x86)\Steam\steamapps\common\ProjectZomboid'
#   output_path:  'C:\pz-tiles-out'
#   render_conf:
#     enable_cache: true        # only on non-hybrid-core CPUs
#     tile_size:    1024        # leave default

# 4. Render top-view only (sufficient for the in-app map; ~2 GB disk)
.\run_top_view_only.bat
```

Output you care about is:

```
C:\pz-tiles-out\html\map_data\<base-name>\base_top\
├── 0\0_0.png                (1x1 tile, whole map)
├── 1\0_0.png … 1_1.png      (2x2 tiles)
├── …
└── N\0_0.png … <maxCol>_<maxRow>.png
```

The `<base-name>` is usually `Knox Country`. Note the DZI naming
convention: `{level}/{col}_{row}.{ext}` with underscores — not slashes.

## Step 2 — upload to HomePL

```powershell
# From the project root, the renderer wrote to C:\pz-tiles-out.
# Upload just the top-view pyramid, rename to 'knox'.
scp -P 2222 -i $HOME\.ssh\id_ed25519 -r `
  "C:\pz-tiles-out\html\map_data\Knox Country\base_top" `
  root@85.215.222.81:/tmp/knox-tiles

ssh -p 2222 -i $HOME\.ssh\id_ed25519 root@85.215.222.81
```

On the server:

```bash
# The pz-data volume is owned 1000:1000 (the node user inside pz-crcon).
install -d -o 1000 -g 1000 /var/lib/docker/volumes/pz-data/_data/tiles
mv /tmp/knox-tiles /var/lib/docker/volumes/pz-data/_data/tiles/knox
chown -R 1000:1000 /var/lib/docker/volumes/pz-data/_data/tiles

# Verify from inside the container
docker exec pz-crcon sh -c 'ls /pz-data/tiles/knox | head -5'
docker exec pz-crcon sh -c 'ls /pz-data/tiles/knox/0'
```

## Step 3 — point the app at the new tiles

Edit `/opt/docker/pz-crcon/.env`:

```bash
PZ_TILES_DIR=/pz-data/tiles
NEXT_PUBLIC_PZ_TILE_URL=/api/tiles/knox/{z}/{x}_{y}.png
NEXT_PUBLIC_PZ_TILE_SIZE=1024
NEXT_PUBLIC_PZ_MIN_ZOOM=0
NEXT_PUBLIC_PZ_MAX_ZOOM=8   # use the highest level folder that exists
```

`NEXT_PUBLIC_*` vars are baked into the client bundle at build time, so
re-create the container (don't just restart):

```bash
cd /opt/docker/pz-crcon
docker compose up -d --force-recreate pz-crcon
```

Sanity check from the host:

```bash
# Should return 200 and a PNG body
curl -sI http://100.114.204.59:3000/api/tiles/knox/0/0_0.png | head -3
```

Then hard-refresh `https://pz.majorluk.pl/` (the public home page has
the live map).

## Step 4 — verify

- DevTools → Network → filter by `/api/tiles/`: every request is `200
  OK` with `Content-Type: image/png` and `Cache-Control:
  public, max-age=31536000, immutable`.
- Console: no `ERR_CERT_*`, no CORS errors, no `tileerror` spam.
- Zooming / panning loads more tiles; missing tiles at the map edges
  are fine (Leaflet shows them transparent).

## Troubleshooting

- **404 from `/api/tiles/knox/0/0_0.png`** — `PZ_TILES_DIR` is wrong or
  the directory permissions don't let UID 1000 read. Run `docker exec
  pz-crcon ls /pz-data/tiles/knox/0` to confirm.
- **Map shows "tiles not configured" overlay even after setting env** —
  `NEXT_PUBLIC_*` are compile-time. Re-create the container, don't
  just `restart`.
- **Tiles are there but in the wrong place / zoom is off** — the DZI
  pyramid's top (level 0) is a 1×1 tile covering the whole map. Your
  `NEXT_PUBLIC_PZ_MAX_ZOOM` must match the highest `level` directory
  that pzmap2dzi produced. Count with `ls /pz-data/tiles/knox | wc -l`
  (subtract 1 — levels are zero-indexed).
- **Coordinates don't align with RCON player markers** — the current
  component uses `crs: L.CRS.Simple` with world bounds `(0,0)-(WORLD_W,
  WORLD_H) = (0,0)-(10224,10576)`. If your pyramid's full-resolution
  extent differs, update `WORLD_W` / `WORLD_H` in
  `components/map/knox-map.tsx` to match the highest-level tile count ×
  tile size.

## Re-rendering

Re-run `run_top_view_only.bat` whenever the PZ game version bumps (your
server is pinned to B41, so this is rare). Upload the new pyramid as
`knox-v2`, `knox-b41-78-17`, etc. — switching `NEXT_PUBLIC_PZ_TILE_URL`
to the new prefix invalidates the browser cache correctly since the
path itself changes.
