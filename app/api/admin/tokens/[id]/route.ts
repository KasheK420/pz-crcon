/**
 * `DELETE /api/admin/tokens/[id]` — revoke an API token (OWNER-only).
 */

import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { atLeast } from "@/lib/auth/role";
import { checkCsrf } from "@/lib/csrf/check";
import { revokeToken } from "@/lib/tokens/api-tokens";
import { recordAudit } from "@/lib/server/audit";

export const dynamic = "force-dynamic";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || !atLeast(session.role, "OWNER")) {
    return NextResponse.json({ ok: false, code: "forbidden" }, { status: 403 });
  }
  const csrf = checkCsrf(req);
  if (!csrf.ok) {
    return NextResponse.json({ ok: false, code: "csrf", reason: csrf.reason }, { status: 403 });
  }
  const { id } = await params;
  const ok = await revokeToken(id);
  if (!ok) {
    return NextResponse.json(
      { ok: false, code: "not-found", detail: `no token with id=${id}` },
      { status: 404 },
    );
  }
  await recordAudit(session.userId, "CONFIG_WRITE", {
    kind: "token.revoke",
    id,
  });
  return NextResponse.json({ ok: true, id });
}
