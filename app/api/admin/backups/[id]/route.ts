/**
 * `DELETE /api/admin/backups/[id]` — remove a tarball + DB row (ADMIN+).
 */

import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { atLeast } from "@/lib/auth/role";
import { checkCsrf } from "@/lib/csrf/check";
import { deleteBackup } from "@/lib/pz/backups";
import { recordAudit } from "@/lib/server/audit";

export const dynamic = "force-dynamic";

export async function DELETE(
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
  const result = await deleteBackup(id);
  if (!result.ok) {
    const status = result.code === "not-found" ? 404 : 400;
    return NextResponse.json(result, { status });
  }
  await recordAudit(session.userId, "CONFIG_WRITE", {
    kind: "backup.delete",
    filename: result.filename,
  });
  return NextResponse.json(result);
}
