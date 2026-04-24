/**
 * `POST /api/admin/mods/sync` — two-mode mod sync (ADMIN+).
 *
 * Body:
 *   { action: "refresh-steam" } — re-fetch titles / thumbnails from Steam
 *   { action: "apply-ini" }     — rewrite server.ini from the DB state
 *
 * These are split from the main list mutation endpoints because both
 * are user-initiated "heavy" ops: "refresh-steam" hits the Steam API
 * (slow, rate-limited) and "apply-ini" touches the live config file
 * (requires PZ restart to fully take effect).
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { atLeast } from "@/lib/auth/role";
import { checkCsrf } from "@/lib/csrf/check";
import { refreshModMetaFromSteam, syncIniFromDb } from "@/lib/pz/mods";
import { recordAudit } from "@/lib/server/audit";

export const dynamic = "force-dynamic";

const Body = z.object({
  action: z.enum(["refresh-steam", "apply-ini"]),
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

  if (body.data.action === "refresh-steam") {
    const result = await refreshModMetaFromSteam();
    if (!result.ok) {
      return NextResponse.json(result, { status: 502 });
    }
    await recordAudit(session.userId, "CONFIG_WRITE", {
      kind: "mod.refresh-steam",
      refreshed: result.refreshed,
      missed: result.missed,
    });
    return NextResponse.json(result);
  }

  // action === "apply-ini"
  const result = await syncIniFromDb();
  if (!result.ok) {
    return NextResponse.json(result, { status: 409 });
  }
  await recordAudit(session.userId, "CONFIG_WRITE", {
    kind: "mod.apply-ini",
    workshopItems: result.workshopItems,
    modsList: result.modsList,
  });
  return NextResponse.json(result);
}
