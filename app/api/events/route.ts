/**
 * `GET /api/events` — paginated WorldEvent history (VIEWER+).
 *
 * Query params:
 *   kind   — single kind or comma-separated list
 *   from   — ISO datetime lower bound (inclusive)
 *   to     — ISO datetime upper bound (inclusive)
 *   limit  — 1..500 (default 100)
 *   cursor — id of the last event from a previous page
 *
 * Reverse-chronological (`ts DESC, id DESC`). Cursor points at an id;
 * the response carries `nextCursor` as a convenience.
 */

import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { atLeast } from "@/lib/auth/role";
import { listEvents, type WorldEventKind } from "@/lib/ingest/events-store";

export const dynamic = "force-dynamic";

const KINDS = [
  "death",
  "join",
  "leave",
  "chat",
  "heli",
  "gunshot",
  "generator",
  "mod_stale",
] as const;

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !atLeast(session.role, "VIEWER")) {
    return NextResponse.json({ ok: false, code: "forbidden" }, { status: 403 });
  }
  const q = req.nextUrl.searchParams;
  const kindRaw = q.get("kind");
  const kinds: WorldEventKind[] | undefined = kindRaw
    ? (kindRaw.split(",").map((s) => s.trim()).filter((s) =>
        (KINDS as readonly string[]).includes(s),
      ) as WorldEventKind[])
    : undefined;
  const from = q.get("from") ? new Date(q.get("from")!) : undefined;
  const to = q.get("to") ? new Date(q.get("to")!) : undefined;
  const limit = Math.min(Number(q.get("limit") ?? 100) || 100, 500);
  const cursor = q.get("cursor") ?? undefined;

  const rows = await listEvents({
    kind: kinds && kinds.length === 1 ? kinds[0] : kinds,
    from,
    to,
    limit,
    cursorId: cursor,
  });
  const nextCursor = rows.length === limit ? rows[rows.length - 1].id : null;
  return NextResponse.json({ ok: true, events: rows, nextCursor });
}
