/**
 * `PUT /api/players/[playerId]/notes` — set or clear the free-text note
 * column on a player (MODERATOR+, CSRF).
 *
 * The schema has `Player.notes: String?` (single-blob, not history). For
 * now that's the full contract — a proper timeline goes into Phase 3 via
 * a dedicated PlayerNote table.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { atLeast } from "@/lib/auth/role";
import { checkCsrf } from "@/lib/csrf/check";
import { prisma } from "@/lib/db/client";
import { recordAudit } from "@/lib/server/audit";

export const dynamic = "force-dynamic";

const Body = z.object({
  notes: z.string().max(2000).nullable(),
});

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ playerId: string }> },
) {
  const session = await getSession();
  if (!session || !atLeast(session.role, "MODERATOR")) {
    return NextResponse.json({ ok: false, code: "forbidden" }, { status: 403 });
  }
  const csrf = checkCsrf(req);
  if (!csrf.ok) {
    return NextResponse.json({ ok: false, code: "csrf", reason: csrf.reason }, { status: 403 });
  }
  const { playerId } = await params;
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, code: "bad-request", detail: "invalid json" },
      { status: 400 },
    );
  }
  const body = Body.safeParse(raw);
  if (!body.success) {
    return NextResponse.json(
      { ok: false, code: "bad-request", detail: body.error.message },
      { status: 400 },
    );
  }
  const player = await prisma.player.findUnique({ where: { id: playerId } });
  if (!player) {
    return NextResponse.json(
      { ok: false, code: "not-found", detail: `no player ${playerId}` },
      { status: 404 },
    );
  }
  const next = body.data.notes?.trim() || null;
  await prisma.player.update({
    where: { id: playerId },
    data: { notes: next },
  });
  await recordAudit(session.userId, "CONFIG_WRITE", {
    kind: "player.notes.update",
    playerId,
    steamId: player.steamId,
    cleared: next === null,
    length: next?.length ?? 0,
  });
  await prisma.adminAction
    .create({
      data: {
        userId: session.userId,
        kind: "player_notes",
        target: player.name,
        details: { playerId, cleared: next === null, length: next?.length ?? 0 },
      },
    })
    .catch(() => {});
  return NextResponse.json({ ok: true, notes: next });
}
