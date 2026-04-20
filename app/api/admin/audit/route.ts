/**
 * `GET /api/admin/audit` — paginated audit feed.
 *
 * Requires MODERATOR+. Cursor pagination using `AuditEvent.id` (cuid, so
 * lexicographic over `createdAt desc` works reliably).
 */

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { atLeast } from "@/lib/auth/role";
import { prisma } from "@/lib/db/client";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session || !atLeast(session.role, "MODERATOR")) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const url = new URL(req.url);
  const limitRaw = Number(url.searchParams.get("limit") ?? 25);
  const limit = Math.max(
    1,
    Math.min(100, Number.isFinite(limitRaw) ? limitRaw : 25),
  );
  const cursor = url.searchParams.get("cursor") ?? undefined;

  const rows = await prisma.auditEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      userId: true,
      kind: true,
      detail: true,
      createdAt: true,
    },
  });

  const nextCursor = rows.length > limit ? rows.pop()!.id : null;
  return NextResponse.json({ ok: true, rows, nextCursor });
}
