/**
 * POST /api/admin/server/abort
 *
 * Flag the current in-flight lifecycle operation to cancel at its next
 * checkpoint. Only the warning-phase sleep loop observes the flag —
 * saves and stops run to completion. ADMIN+; CSRF-gated.
 *
 * Returns 200 in all cases (idempotent) with a `{ aborted: boolean }`
 * hint describing whether there was actually anything to abort.
 */

import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { atLeast } from "@/lib/auth/role";
import { checkCsrf } from "@/lib/csrf/check";
import { abortCurrent, getPhase } from "@/lib/server/lifecycle";
import { recordAudit } from "@/lib/server/audit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !atLeast(session.role, "ADMIN")) {
    return NextResponse.json(
      { ok: false, code: "forbidden" },
      { status: 403 },
    );
  }
  const csrf = checkCsrf(req);
  if (!csrf.ok) {
    return NextResponse.json(
      { ok: false, code: "csrf", reason: csrf.reason },
      { status: 403 },
    );
  }
  const phaseBefore = getPhase();
  abortCurrent();
  await recordAudit(session.userId, "LIFECYCLE_ABORT", { phaseBefore });
  return NextResponse.json({
    ok: true,
    aborted: phaseBefore !== "idle",
    phaseBefore,
  });
}
