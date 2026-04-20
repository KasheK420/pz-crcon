/**
 * `GET /api/admin/config/ini`  — redacted config read (VIEWER+).
 * `PUT /api/admin/config/ini`  — OWNER-only edit with CSRF + mtime gate.
 *
 * Secrets (descriptor.secret === true) are masked server-side for any
 * role below OWNER. The raw values are exposed only through the
 * sibling `/secrets` route.
 *
 * PUT error → HTTP mapping:
 *   mtime-race | lifecycle-busy | config-busy         → 409
 *   config-dir-unreachable                             → 503
 *   validation | unknown-key | serialize-shape-unsupported | empty-patch → 400
 *   everything else                                    → 500
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { atLeast } from "@/lib/auth/role";
import { checkCsrf } from "@/lib/csrf/check";
import { readServerIni } from "@/lib/pz/config-reader";
import { writeServerIni, type WriteFailureCode } from "@/lib/pz/writer";
import { INI_DESCRIPTORS } from "@/lib/pz/ini-descriptors";
import { recordAudit } from "@/lib/server/audit";
import { getLogger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const log = () => getLogger().child({ mod: "api/config/ini" });

const REDACTED = "__REDACTED__";

export async function GET() {
  const session = await getSession();
  if (!session || !atLeast(session.role, "VIEWER")) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const r = await readServerIni();
  if (!r.ok) {
    return NextResponse.json(
      { ok: false, error: r.error, path: r.path, prefix: r.prefix },
      { status: 503 },
    );
  }

  const redact = !atLeast(session.role, "OWNER");
  const entries = (r.parsed?.entries ?? []).map((e) => {
    const d = INI_DESCRIPTORS[e.key];
    if (redact && d?.secret) {
      return { key: e.key, value: REDACTED, redacted: true as const };
    }
    return { key: e.key, value: e.value };
  });

  return NextResponse.json({
    ok: true,
    path: r.path,
    prefix: r.prefix,
    mtimeMs: r.mtimeMs,
    entries,
  });
}

const PutBody = z.object({
  clientMtimeMs: z.number(),
  patch: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
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

  const result = await writeServerIni(body.data.patch, {
    clientMtimeMs: body.data.clientMtimeMs,
  });
  if (!result.ok) {
    log().warn(
      { code: result.code, detail: result.detail, userId: session.userId },
      "ini PUT rejected",
    );
    return NextResponse.json(result, { status: statusForCode(result.code) });
  }

  const requiresRestart = result.diff.some(
    (d) => INI_DESCRIPTORS[d.path]?.requiresRestart === true,
  );
  await recordAudit(session.userId, "CONFIG_WRITE", {
    file: "ini",
    diff: result.diff,
  });

  return NextResponse.json({ ...result, requiresRestart });
}
