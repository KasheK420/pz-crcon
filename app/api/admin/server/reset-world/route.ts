/**
 * POST /api/admin/server/reset-world
 *
 * Destructive world reset. OWNER-only, CSRF-gated, requires the client
 * to echo the detected server prefix back as a typed confirmation
 * (mirrors the GitHub "type the repo name to delete" pattern).
 *
 * Body schema:
 *   {
 *     mode: "world" | "total-nuke",
 *     confirmPrefix: string    // MUST equal detectServerPrefix()
 *   }
 *
 * Response codes:
 *   200  { ok: true, mode, prefix, trashed, pruned }
 *   400  bad body
 *   403  not OWNER / CSRF failure / confirm mismatch
 *   409  lifecycle busy
 *   422  world-reset failed (server was running, path unsafe, etc.)
 *   503  docker proxy unreachable
 *   500  unknown error
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { atLeast } from "@/lib/auth/role";
import { checkCsrf } from "@/lib/csrf/check";
import { detectServerPrefix } from "@/lib/pz/config-reader";
import {
  LifecycleBusyError,
  ProxyUnreachableError,
  WorldResetFailedError,
  resetWorld,
} from "@/lib/server/lifecycle";
import { recordAudit } from "@/lib/server/audit";
import { getLogger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const log = () => getLogger().child({ mod: "api/server/reset-world" });

const Body = z.object({
  mode: z.enum(["world", "total-nuke"]),
  confirmPrefix: z.string().min(1).max(64),
});

const DEFAULT_WARNING_SECONDS = 30;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !atLeast(session.role, "OWNER")) {
    return NextResponse.json(
      { ok: false, code: "forbidden", detail: "OWNER required" },
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
  const raw = await req.json().catch(() => ({}));
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, code: "bad-request", detail: parsed.error.message },
      { status: 400 },
    );
  }
  const { mode, confirmPrefix } = parsed.data;

  // Require the caller to echo the detected prefix — prevents
  // drive-by POSTs and "oh crap wrong server" situations where a
  // stale browser tab from another deployment issues the call.
  let detectedPrefix: string;
  try {
    detectedPrefix = await detectServerPrefix();
  } catch (e) {
    log().error(
      { err: e instanceof Error ? e.message : String(e) },
      "prefix-detect failed",
    );
    return NextResponse.json(
      { ok: false, code: "prefix-detect-failed" },
      { status: 500 },
    );
  }
  if (confirmPrefix !== detectedPrefix) {
    return NextResponse.json(
      {
        ok: false,
        code: "confirm-mismatch",
        detail: `expected confirmPrefix="${detectedPrefix}", got "${confirmPrefix}"`,
      },
      { status: 403 },
    );
  }

  const t0 = Date.now();
  log().warn(
    { userId: session.userId, mode, prefix: detectedPrefix },
    "WORLD RESET INITIATED",
  );
  try {
    const wipe = await resetWorld(mode, DEFAULT_WARNING_SECONDS);
    if (!wipe.ok) {
      // resetWorld already threw in this case via WorldResetFailedError;
      // treated as a defensive branch so the type-checker is happy.
      return NextResponse.json(
        { ok: false, code: wipe.code, detail: wipe.detail },
        { status: 422 },
      );
    }
    await recordAudit(session.userId, "LIFECYCLE_RESTART", {
      action: "world-reset",
      mode,
      prefix: wipe.prefix,
      trashed: wipe.trashed,
      pruned: wipe.pruned,
      durationMs: Date.now() - t0,
    });
    return NextResponse.json({
      ok: true,
      mode: wipe.mode,
      prefix: wipe.prefix,
      trashed: wipe.trashed,
      pruned: wipe.pruned,
      durationMs: Date.now() - t0,
    });
  } catch (e) {
    log().error(
      { err: e instanceof Error ? e.message : String(e) },
      "world-reset failed",
    );
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
    if (e instanceof WorldResetFailedError) {
      return NextResponse.json(
        { ok: false, code: e.code, detail: e.detail },
        { status: 422 },
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
