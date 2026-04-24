/**
 * `GET /api/deaths` — list recent death events for map overlays.
 *
 * Public access is allowed but anonymised: names are redacted and coords
 * are snapped to a 500-tile grid. VIEWER+ sessions get the unmodified row.
 */

import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { atLeast } from "@/lib/auth/role";
import { listEvents } from "@/lib/ingest/events-store";

export const dynamic = "force-dynamic";

const PUBLIC_GRID = 500;
const PUBLIC_RETENTION_DAYS = 7;

export async function GET(req: NextRequest) {
  const session = await getSession();
  const isAdmin = Boolean(session && atLeast(session.role, "VIEWER"));

  const q = req.nextUrl.searchParams;
  const limit = Math.min(Number(q.get("limit") ?? 50) || 50, 200);
  const from = isAdmin
    ? q.get("from")
      ? new Date(q.get("from")!)
      : undefined
    : new Date(Date.now() - PUBLIC_RETENTION_DAYS * 86_400_000);

  const rows = await listEvents({ kind: "death", from, limit });

  const out = rows.map((r) => {
    if (isAdmin) {
      return {
        id: r.id,
        ts: r.ts.toISOString(),
        player: r.player,
        x: r.x,
        y: r.y,
        region: r.region,
        meta: r.metaJson,
      };
    }
    return {
      id: r.id,
      ts: r.ts.toISOString(),
      x: r.x != null ? Math.floor(r.x / PUBLIC_GRID) * PUBLIC_GRID : null,
      y: r.y != null ? Math.floor(r.y / PUBLIC_GRID) * PUBLIC_GRID : null,
      region: r.region,
    };
  });

  return NextResponse.json({ ok: true, deaths: out, anonymised: !isAdmin });
}
