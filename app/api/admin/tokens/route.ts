/**
 * `GET /api/admin/tokens`  — list API tokens (OWNER-only; tokens are a
 *                            privileged surface for server-to-server auth).
 * `POST /api/admin/tokens` — generate a new token (OWNER-only).
 *
 * Only the POST response carries the raw token (shown once in the UI).
 * Everything else exposes prefix + hash metadata only.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { atLeast } from "@/lib/auth/role";
import { checkCsrf } from "@/lib/csrf/check";
import { createToken, listTokens } from "@/lib/tokens/api-tokens";
import { recordAudit } from "@/lib/server/audit";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session || !atLeast(session.role, "OWNER")) {
    return NextResponse.json({ ok: false, code: "forbidden" }, { status: 403 });
  }
  const rows = await listTokens();
  return NextResponse.json({ ok: true, tokens: rows });
}

const Body = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(z.string().min(1).max(40)).default([]),
  expiresInDays: z.number().int().positive().max(3650).optional(),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !atLeast(session.role, "OWNER")) {
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
  const expiresAt = body.data.expiresInDays
    ? new Date(Date.now() + body.data.expiresInDays * 86_400_000)
    : null;
  const result = await createToken({
    userId: session.userId,
    name: body.data.name,
    scopes: body.data.scopes,
    expiresAt,
  });
  await recordAudit(session.userId, "CONFIG_WRITE", {
    kind: "token.create",
    id: result.row.id,
    name: result.row.name,
    scopes: result.row.scopes,
    prefix: result.row.prefix,
  });
  return NextResponse.json({ ok: true, ...result });
}
