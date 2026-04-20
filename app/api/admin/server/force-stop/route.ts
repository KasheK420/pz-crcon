/**
 * POST /api/admin/server/force-stop
 *
 * Break-glass: `docker kill pz-server`. No RCON, no save, no warning.
 * OWNER-only and the operator must POST `{ "confirm": "FORCE-STOP" }`
 * (exact string match, case-sensitive) as a guard against fat-finger.
 *
 * Errors:
 *   400 { ok: false, code: "bad-confirm" } — missing or wrong confirm
 *   403 { ok: false, code: "forbidden" | "csrf" }
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { atLeast } from "@/lib/auth/role";
import { checkCsrf } from "@/lib/csrf/check";
import {
  forceStop,
  LifecycleBusyError,
  ProxyUnreachableError,
} from "@/lib/server/lifecycle";
import { recordAudit } from "@/lib/server/audit";
import { getLogger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const log = () => getLogger().child({ mod: "api/server/force-stop" });

const Body = z.object({ confirm: z.string() });

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !atLeast(session.role, "OWNER")) {
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
  if (!body.success || body.data.confirm !== "FORCE-STOP") {
    return NextResponse.json(
      { ok: false, code: "bad-confirm" },
      { status: 400 },
    );
  }

  const t0 = Date.now();
  try {
    await forceStop();
    await recordAudit(session.userId, "LIFECYCLE_FORCE_STOP", {
      durationMs: Date.now() - t0,
    });
    return NextResponse.json({ ok: true, durationMs: Date.now() - t0 });
  } catch (e) {
    log().warn({ err: e instanceof Error ? e.message : String(e) }, "force-stop failed");
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
