/**
 * `PUT /api/admin/mods/[id]` — toggle enabled / rename / edit modId (ADMIN+).
 * `DELETE /api/admin/mods/[id]` — remove mod from panel + INI (ADMIN+).
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { atLeast } from "@/lib/auth/role";
import { checkCsrf } from "@/lib/csrf/check";
import { removeMod, toggleMod, updateModDetails } from "@/lib/pz/mods";
import { recordAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/db/client";

export const dynamic = "force-dynamic";

const PutBody = z.object({
  enabled: z.boolean().optional(),
  modId: z.string().min(1).max(64).optional(),
  name: z.string().min(1).max(200).optional(),
  applyToIni: z.boolean().optional(),
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
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, code: "bad-request", detail: "invalid json" },
      { status: 400 },
    );
  }
  const body = PutBody.safeParse(raw);
  if (!body.success) {
    return NextResponse.json(
      { ok: false, code: "bad-request", detail: body.error.message },
      { status: 400 },
    );
  }
  const { enabled, modId, name, applyToIni } = body.data;

  if (enabled !== undefined) {
    const r = await toggleMod(id, enabled, { applyToIni });
    if (!r.ok) {
      const status =
        r.code === "not-found"
          ? 404
          : r.code === "invalid-input"
            ? 400
            : 409;
      return NextResponse.json(r, { status });
    }
    await recordAudit(session.userId, "CONFIG_WRITE", {
      kind: "mod.toggle",
      workshopId: r.mod.workshopId,
      enabled,
      iniApplied: r.iniApplied,
    });
    await prisma.adminAction
      .create({
        data: {
          userId: session.userId,
          kind: enabled ? "MOD_ENABLED" : "MOD_DISABLED",
          target: r.mod.workshopId,
          details: { name: r.mod.name },
        },
      })
      .catch(() => {});
    return NextResponse.json(r);
  }

  if (modId !== undefined || name !== undefined) {
    const r = await updateModDetails(id, { modId, name }, { applyToIni });
    if (!r.ok) {
      const status =
        r.code === "not-found"
          ? 404
          : r.code === "invalid-input"
            ? 400
            : 409;
      return NextResponse.json(r, { status });
    }
    await recordAudit(session.userId, "CONFIG_WRITE", {
      kind: "mod.update",
      workshopId: r.mod.workshopId,
      modId: r.mod.modId,
      iniApplied: r.iniApplied,
    });
    return NextResponse.json(r);
  }

  return NextResponse.json(
    { ok: false, code: "bad-request", detail: "no-op body" },
    { status: 400 },
  );
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
  const result = await removeMod(id);
  if (!result.ok) {
    const status = result.code === "not-found" ? 404 : 409;
    return NextResponse.json(result, { status });
  }
  await recordAudit(session.userId, "CONFIG_WRITE", {
    kind: "mod.remove",
    workshopId: result.mod.workshopId,
    iniApplied: result.iniApplied,
  });
  await prisma.adminAction
    .create({
      data: {
        userId: session.userId,
        kind: "MOD_REMOVED",
        target: result.mod.workshopId,
        details: { name: result.mod.name },
      },
    })
    .catch(() => {});
  return NextResponse.json(result);
}
