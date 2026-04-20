/**
 * Thin helper around Prisma's `AuditEvent` model.
 *
 * Intentionally swallows write errors: audit is best-effort telemetry —
 * failing to log must never block the caller (e.g., a config write) from
 * succeeding. Errors are logged via the shared logger.
 */

import { prisma } from "@/lib/db/client";
import type { AuditKind } from "@prisma/client";
import { getLogger } from "@/lib/logger";

const log = () => getLogger().child({ mod: "server/audit" });

export async function recordAudit(
  userId: string,
  kind: AuditKind,
  detail: Record<string, unknown>,
): Promise<void> {
  try {
    await prisma.auditEvent.create({
      data: { userId, kind, detail: detail as never },
    });
  } catch (e) {
    log().error(
      { err: e instanceof Error ? e.message : String(e), kind, userId },
      "audit write failed",
    );
  }
}
