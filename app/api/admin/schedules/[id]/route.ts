/**
 * `PUT /api/admin/schedules/[id]`    — update fields (ADMIN+).
 * `DELETE /api/admin/schedules/[id]` — remove schedule (ADMIN+).
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { atLeast } from "@/lib/auth/role";
import { checkCsrf } from "@/lib/csrf/check";
import { prisma } from "@/lib/db/client";
import { nextFireAt, parseCron } from "@/lib/schedules/cron";
import { recordAudit } from "@/lib/server/audit";

export const dynamic = "force-dynamic";

const Body = z.object({
  name: z.string().min(1).max(100).optional(),
  cronExpr: z.string().min(1).optional(),
  kind: z.enum(["announce", "restart", "restart-warn", "auto-backup"]).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().optional(),
});

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || !atLeast(session.role, "ADMIN")) {
    return NextResponse.json({ ok: false, code: "forbidden" }, { status: 403 });
  }
  const csrf = checkCsrf(req);
  if (!csrf.ok) {
    return NextResponse.json({ ok: false, code: "csrf", reason: csrf.reason }, { status: 403 });
  }
  const { id } = await params;
  const existing = await prisma.schedule.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json(
      { ok: false, code: "not-found", detail: `no schedule with id=${id}` },
      { status: 404 },
    );
  }
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

  let nextRunAt = existing.nextRunAt;
  if (body.data.cronExpr) {
    const parsed = parseCron(body.data.cronExpr);
    if (!parsed.ok) {
      return NextResponse.json(
        { ok: false, code: "bad-cron", detail: parsed.error },
        { status: 400 },
      );
    }
    nextRunAt = nextFireAt(parsed) ?? null;
  }

  const updated = await prisma.schedule.update({
    where: { id },
    data: {
      ...(body.data.name !== undefined ? { name: body.data.name } : {}),
      ...(body.data.cronExpr !== undefined ? { cronExpr: body.data.cronExpr } : {}),
      ...(body.data.kind !== undefined ? { kind: body.data.kind } : {}),
      ...(body.data.payload !== undefined ? { payload: body.data.payload as never } : {}),
      ...(body.data.enabled !== undefined ? { enabled: body.data.enabled } : {}),
      nextRunAt,
    },
  });
  await recordAudit(session.userId, "CONFIG_WRITE", {
    kind: "schedule.update",
    id: updated.id,
    patch: body.data,
  });
  return NextResponse.json({ ok: true, schedule: updated });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || !atLeast(session.role, "ADMIN")) {
    return NextResponse.json({ ok: false, code: "forbidden" }, { status: 403 });
  }
  const csrf = checkCsrf(req);
  if (!csrf.ok) {
    return NextResponse.json({ ok: false, code: "csrf", reason: csrf.reason }, { status: 403 });
  }
  const { id } = await params;
  const existing = await prisma.schedule.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json(
      { ok: false, code: "not-found", detail: `no schedule with id=${id}` },
      { status: 404 },
    );
  }
  await prisma.schedule.delete({ where: { id } });
  await recordAudit(session.userId, "CONFIG_WRITE", {
    kind: "schedule.delete",
    id,
    name: existing.name,
  });
  return NextResponse.json({ ok: true, id });
}
