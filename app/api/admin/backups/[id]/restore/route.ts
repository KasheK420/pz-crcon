/**
 * `POST /api/admin/backups/[id]/restore` — restore a tarball over the live
 * world (OWNER-only).
 *
 * Flow:
 *   1. Verify PZ container is NOT running (we inspect via dockerode).
 *   2. Pre-trash the live save dir + config files (rename to
 *      `.pre-restore-<iso>` siblings). Reversible if extraction fails.
 *   3. `tar -xzf <tarball> -C <data-dir>`.
 *   4. On failure, roll back the pre-trash renames and surface a
 *      structured error.
 *
 * The OWNER gate mirrors the Danger Zone wipe semantics — restore is
 * just as destructive, because the live world is replaced in-place.
 */

import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { atLeast } from "@/lib/auth/role";
import { checkCsrf } from "@/lib/csrf/check";
import { restoreBackup } from "@/lib/pz/backups";
import { recordAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/db/client";
import { inspectContainer } from "@/lib/docker/client";

export const dynamic = "force-dynamic";

const PZ_CONTAINER = process.env.PZ_CONTAINER_NAME ?? "pz-server";

export async function POST(
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

  const info = await inspectContainer(PZ_CONTAINER);
  const running = Boolean(info?.State?.Running);
  if (running) {
    return NextResponse.json(
      {
        ok: false,
        code: "server-running",
        detail: `${PZ_CONTAINER} is running — stop it from the server controls, then retry.`,
      },
      { status: 409 },
    );
  }

  const result = await restoreBackup({
    id,
    containerRunning: false,
    userId: session.userId,
  });
  if (!result.ok) {
    const status =
      result.code === "not-found"
        ? 404
        : result.code === "server-running"
          ? 409
          : result.code === "tar-missing"
            ? 410
            : result.code === "data-dir-unreachable"
              ? 503
              : 500;
    return NextResponse.json(result, { status });
  }

  await recordAudit(session.userId, "CONFIG_WRITE", {
    kind: "backup.restore",
    filename: result.filename,
    preRestoreTrashed: result.preRestoreTrashed.length,
  });
  await prisma.adminAction
    .create({
      data: {
        userId: session.userId,
        kind: "BACKUP_RESTORED",
        target: result.filename,
        details: { preRestoreTrashed: result.preRestoreTrashed.length },
      },
    })
    .catch(() => {});

  return NextResponse.json(result);
}
