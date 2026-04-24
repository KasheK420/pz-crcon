/**
 * `GET /api/admin/schedules`  — list all schedules (VIEWER+).
 * `POST /api/admin/schedules` — create a new schedule (ADMIN+).
 *
 * Each row has a cron expression that the runner (started in
 * `server/ws.ts`) evaluates every minute. Creating a disabled schedule
 * is allowed — the runner skips it until `enabled=true`.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { atLeast } from "@/lib/auth/role";
import { checkCsrf } from "@/lib/csrf/check";
import { prisma } from "@/lib/db/client";
import { describeCron, nextFireAt, parseCron } from "@/lib/schedules/cron";
import { SCHEDULE_KINDS } from "@/lib/schedules/actions";
import { recordAudit } from "@/lib/server/audit";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session || !atLeast(session.role, "VIEWER")) {
    return NextResponse.json({ ok: false, code: "forbidden" }, { status: 403 });
  }
  const rows = await prisma.schedule.findMany({
    orderBy: [{ enabled: "desc" }, { name: "asc" }],
  });
  const out = rows.map((r) => {
    const parsed = parseCron(r.cronExpr);
    return {
      id: r.id,
      name: r.name,
      cronExpr: r.cronExpr,
      kind: r.kind,
      payload: r.payload,
      enabled: r.enabled,
      lastRunAt: r.lastRunAt?.toISOString() ?? null,
      nextRunAt: r.nextRunAt?.toISOString() ?? null,
      cronValid: parsed.ok,
      cronError: parsed.ok ? null : parsed.error,
      cronDescription: describeCron(r.cronExpr),
    };
  });
  return NextResponse.json({ ok: true, schedules: out, availableKinds: SCHEDULE_KINDS });
}

const Body = z.object({
  name: z.string().min(1).max(100),
  cronExpr: z.string().min(1),
  kind: z.enum(["announce", "restart", "restart-warn", "auto-backup"]),
  payload: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !atLeast(session.role, "ADMIN")) {
    return NextResponse.json({ ok: false, code: "forbidden" }, { status: 403 });
  }
  const csrf = checkCsrf(req);
  if (!csrf.ok) {
    return NextResponse.json({ ok: false, code: "csrf", reason: csrf.reason }, { status: 403 });
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
  const parsed = parseCron(body.data.cronExpr);
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, code: "bad-cron", detail: parsed.error },
      { status: 400 },
    );
  }
  const next = nextFireAt(parsed);
  const created = await prisma.schedule.create({
    data: {
      name: body.data.name,
      cronExpr: body.data.cronExpr,
      kind: body.data.kind,
      payload: (body.data.payload ?? {}) as never,
      enabled: body.data.enabled ?? true,
      nextRunAt: next ?? null,
    },
  });
  await recordAudit(session.userId, "CONFIG_WRITE", {
    kind: "schedule.create",
    name: created.name,
    cronExpr: created.cronExpr,
    scheduleKind: created.kind,
    enabled: created.enabled,
  });
  return NextResponse.json({ ok: true, schedule: created });
}
