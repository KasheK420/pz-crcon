/**
 * `PUT /api/admin/mods/reorder` — full reorder of the mod list (ADMIN+).
 *
 * Body: `{ orderedIds: string[] }` — mod IDs in the desired load order.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { atLeast } from "@/lib/auth/role";
import { checkCsrf } from "@/lib/csrf/check";
import { reorderMods } from "@/lib/pz/mods";
import { recordAudit } from "@/lib/server/audit";

export const dynamic = "force-dynamic";

const Body = z.object({
  orderedIds: z.array(z.string().min(1)).min(1),
  applyToIni: z.boolean().optional(),
});

export async function PUT(req: NextRequest) {
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
  const result = await reorderMods(body.data.orderedIds, { applyToIni: body.data.applyToIni });
  if (!result.ok) {
    const status =
      result.code === "not-found" ? 404 : result.code === "invalid-input" ? 400 : 409;
    return NextResponse.json(result, { status });
  }
  await recordAudit(session.userId, "CONFIG_WRITE", {
    kind: "mod.reorder",
    count: result.mods.length,
    iniApplied: result.iniApplied,
  });
  return NextResponse.json(result);
}
