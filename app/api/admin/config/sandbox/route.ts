/**
 * `GET /api/admin/config/sandbox` — sandbox vars read (VIEWER+).
 * `PUT /api/admin/config/sandbox` — OWNER-only edit with CSRF + mtime gate.
 *
 * Sandbox keys are never secret, so no redaction is needed; every sandbox
 * key is restart-only, so the response always carries `requiresRestart: true`.
 *
 * PUT error → HTTP mapping mirrors /ini; see that file for rationale.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { atLeast } from "@/lib/auth/role";
import { checkCsrf } from "@/lib/csrf/check";
import { readSandboxVars } from "@/lib/pz/config-reader";
import { writeSandboxVars, type WriteFailureCode } from "@/lib/pz/writer";
import { SANDBOX_DESCRIPTORS } from "@/lib/pz/sandbox-descriptors";
import { recordAudit } from "@/lib/server/audit";
import { getLogger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const log = () => getLogger().child({ mod: "api/config/sandbox" });

export async function GET() {
  const session = await getSession();
  if (!session || !atLeast(session.role, "VIEWER")) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const r = await readSandboxVars();
  if (!r.ok) {
    return NextResponse.json(
      { ok: false, error: r.error, path: r.path, prefix: r.prefix },
      { status: 503 },
    );
  }
  return NextResponse.json({
    ok: true,
    path: r.path,
    prefix: r.prefix,
    mtimeMs: r.mtimeMs,
    sections: r.parsed?.sections ?? [],
    descriptors: SANDBOX_DESCRIPTORS,
  });
}

const PutBody = z.object({
  clientMtimeMs: z.number(),
  patch: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  priorValues: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .optional(),
});

function statusForCode(code: WriteFailureCode): number {
  if (
    code === "mtime-race" ||
    code === "lifecycle-busy" ||
    code === "config-busy"
  ) {
    return 409;
  }
  if (code === "config-dir-unreachable") return 503;
  if (
    code === "validation" ||
    code === "unknown-key" ||
    code === "serialize-shape-unsupported" ||
    code === "empty-patch"
  ) {
    return 400;
  }
  return 500;
}

export async function PUT(req: NextRequest) {
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
  const body = PutBody.safeParse(raw);
  if (!body.success) {
    return NextResponse.json(
      { ok: false, code: "bad-request", detail: body.error.message },
      { status: 400 },
    );
  }

  const result = await writeSandboxVars(body.data.patch, {
    clientMtimeMs: body.data.clientMtimeMs,
    priorValues: body.data.priorValues,
  });
  if (!result.ok) {
    log().warn(
      { code: result.code, detail: result.detail, userId: session.userId },
      "sandbox PUT rejected",
    );
    return NextResponse.json(result, { status: statusForCode(result.code) });
  }

  await recordAudit(session.userId, "CONFIG_WRITE", {
    file: "sandbox",
    diff: result.diff,
  });

  // Every sandbox key requires a restart.
  return NextResponse.json({ ...result, requiresRestart: true });
}
