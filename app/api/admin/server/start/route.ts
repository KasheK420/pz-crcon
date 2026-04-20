/**
 * POST /api/admin/server/start
 *
 * Start the PZ container if it is currently stopped. ADMIN+; CSRF-gated.
 * Responds:
 *   200 { ok: true, durationMs }
 *   403 { ok: false, code: "forbidden" | "csrf" }
 *   409 { ok: false, code: "lifecycle-busy" }
 *   503 { ok: false, code: "proxy-unreachable" }
 *   500 { ok: false, code: "error", detail }
 */

import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { atLeast } from "@/lib/auth/role";
import { checkCsrf } from "@/lib/csrf/check";
import {
  startIfStopped,
  LifecycleBusyError,
  ProxyUnreachableError,
} from "@/lib/server/lifecycle";
import { recordAudit } from "@/lib/server/audit";
import { getLogger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const log = () => getLogger().child({ mod: "api/server/start" });

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
  const t0 = Date.now();
  try {
    await startIfStopped();
    await recordAudit(session.userId, "LIFECYCLE_START", {
      durationMs: Date.now() - t0,
    });
    return NextResponse.json({ ok: true, durationMs: Date.now() - t0 });
  } catch (e) {
    log().warn({ err: e instanceof Error ? e.message : String(e) }, "start failed");
    if (e instanceof LifecycleBusyError) {
      return NextResponse.json(
        { ok: false, code: "lifecycle-busy" },
        { status: 409 },
      );
    }
    if (e instanceof ProxyUnreachableError) {
      return NextResponse.json(
        { ok: false, code: "proxy-unreachable" },
        { status: 503 },
      );
    }
    return NextResponse.json(
      {
        ok: false,
        code: "error",
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }
}
