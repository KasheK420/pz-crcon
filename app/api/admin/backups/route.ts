/**
 * `GET /api/admin/backups` — list backups + orphans (VIEWER+).
 * `POST /api/admin/backups` — create a new backup (ADMIN+).
 *
 * Creating a backup runs `tar -czf` over the save dir + configs from the
 * pz-data volume mount. Safe to run while the PZ server is live (the
 * tarball may be a tick or two behind the live world, which is OK for
 * a snapshot — operators who need bit-perfect backups can stop the
 * server first via the lifecycle controls).
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { atLeast } from "@/lib/auth/role";
import { checkCsrf } from "@/lib/csrf/check";
import { createBackup, listBackups } from "@/lib/pz/backups";
import { recordAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/db/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session || !atLeast(session.role, "VIEWER")) {
    return NextResponse.json({ ok: false, code: "forbidden" }, { status: 403 });
  }
  const result = await listBackups();
  return NextResponse.json({ ok: true, ...result });
}

const PostBody = z.object({
  kind: z.enum(["MANUAL", "AUTO", "PRE_RESTART", "PRE_MOD_UPDATE"]).optional(),
  notes: z.string().max(500).optional(),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !atLeast(session.role, "ADMIN")) {
    return NextResponse.json({ ok: false, code: "forbidden" }, { status: 403 });
  }
  const csrf = checkCsrf(req);
  if (!csrf.ok) {
    return NextResponse.json({ ok: false, code: "csrf", reason: csrf.reason }, { status: 403 });
  }
  let raw: unknown = {};
  try {
    const text = await req.text();
    raw = text ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json(
      { ok: false, code: "bad-request", detail: "invalid json" },
      { status: 400 },
    );
  }
  const body = PostBody.safeParse(raw);
  if (!body.success) {
    return NextResponse.json(
      { ok: false, code: "bad-request", detail: body.error.message },
      { status: 400 },
    );
  }

  const result = await createBackup({
    kind: body.data.kind ?? "MANUAL",
    userId: session.userId,
    notes: body.data.notes ?? null,
  });
  if (!result.ok) {
    const status =
      result.code === "world-missing"
        ? 404
        : result.code === "data-dir-unreachable" ||
            result.code === "backup-dir-unwritable"
          ? 503
          : 500;
    return NextResponse.json(result, { status });
  }
  await recordAudit(session.userId, "CONFIG_WRITE", {
    kind: "backup.create",
    filename: result.row.filename,
    bytes: result.row.sizeBytes,
    backupKind: result.row.kind,
  });
  await prisma.adminAction
    .create({
      data: {
        userId: session.userId,
        kind: "BACKUP_CREATED",
        target: result.row.filename,
        details: { bytes: result.row.sizeBytes, kind: result.row.kind },
      },
    })
    .catch(() => {});
  return NextResponse.json(result);
}
