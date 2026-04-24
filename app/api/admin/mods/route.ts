/**
 * `GET /api/admin/mods` — list all mods + INI drift status (VIEWER+).
 * `POST /api/admin/mods` — add a mod by Workshop ID or URL (ADMIN+).
 *
 * Failure code → HTTP mapping:
 *   invalid-input / duplicate          → 400
 *   not-found                          → 404
 *   steam-unreachable / steam-rejected → 502
 *   ini-write                          → 409 (typically lifecycle-busy)
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { atLeast } from "@/lib/auth/role";
import { checkCsrf } from "@/lib/csrf/check";
import { addMod, listMods } from "@/lib/pz/mods";
import { recordAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/db/client";
import { getLogger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const log = () => getLogger().child({ mod: "api/admin/mods" });

export async function GET() {
  const session = await getSession();
  if (!session || !atLeast(session.role, "VIEWER")) {
    return NextResponse.json({ ok: false, code: "forbidden" }, { status: 403 });
  }
  const result = await listMods();
  return NextResponse.json({ ok: true, ...result });
}

const PostBody = z.object({
  workshopRef: z.string().min(1),
  applyToIni: z.boolean().optional(),
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
  const body = PostBody.safeParse(raw);
  if (!body.success) {
    return NextResponse.json(
      { ok: false, code: "bad-request", detail: body.error.message },
      { status: 400 },
    );
  }

  const result = await addMod(body.data.workshopRef, {
    applyToIni: body.data.applyToIni,
  });
  if (!result.ok) {
    log().warn({ code: result.code, detail: result.detail }, "mods add rejected");
    const status =
      result.code === "duplicate" || result.code === "invalid-input"
        ? 400
        : result.code === "not-found"
          ? 404
          : result.code === "steam-unreachable" || result.code === "steam-rejected"
            ? 502
            : 409;
    return NextResponse.json(result, { status });
  }
  await recordAudit(session.userId, "CONFIG_WRITE", {
    kind: "mod.add",
    workshopId: result.mod.workshopId,
    modId: result.mod.modId,
    iniApplied: result.iniApplied,
  });
  // Also a coarse AdminAction row so the activity-feed renders it.
  await prisma.adminAction
    .create({
      data: {
        userId: session.userId,
        kind: "MOD_ADDED",
        target: result.mod.workshopId,
        details: { name: result.mod.name, iniApplied: result.iniApplied },
      },
    })
    .catch(() => {});
  return NextResponse.json(result);
}
