/**
 * `POST /api/admin/schedules/[id]/fire` — fire a schedule now, outside its
 * cron (ADMIN+). Useful for "test this restart-warn right now".
 */

import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { atLeast } from "@/lib/auth/role";
import { checkCsrf } from "@/lib/csrf/check";
import { fireScheduleNow } from "@/lib/schedules/runner";
import { recordAudit } from "@/lib/server/audit";

export const dynamic = "force-dynamic";

export async function POST(
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
  const result = await fireScheduleNow(id);
  await recordAudit(session.userId, "CONFIG_WRITE", {
    kind: "schedule.fire",
    id,
    detail: result.detail,
    ok: result.ok,
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
