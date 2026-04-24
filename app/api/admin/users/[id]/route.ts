/**
 * `PATCH /api/admin/users/[id]`  — change a user's role (OWNER only).
 * `DELETE /api/admin/users/[id]` — delete the `User` row (OWNER only).
 *
 * Invariants:
 *   - Cannot demote the last remaining OWNER — returns 400 with
 *     `code: "last-owner"` so the UI can explain.
 *   - Cannot delete self.
 *   - Deleting a user doesn't un-allowlist them — if their Discord ID
 *     is still in `DISCORD_ADMIN_IDS`, they'll be re-created on next
 *     sign-in with the default role rule.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { atLeast, type Role } from "@/lib/auth/role";
import { checkCsrf } from "@/lib/csrf/check";
import { prisma } from "@/lib/db/client";
import { recordAudit } from "@/lib/server/audit";

export const dynamic = "force-dynamic";

const PatchBody = z.object({
  role: z.enum(["VIEWER", "MODERATOR", "ADMIN", "OWNER"]),
});

async function countOwners(): Promise<number> {
  return prisma.user.count({ where: { role: "OWNER" } });
}

export async function PATCH(
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
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json(
      { ok: false, code: "not-found", detail: `no user with id=${id}` },
      { status: 404 },
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
  const body = PatchBody.safeParse(raw);
  if (!body.success) {
    return NextResponse.json(
      { ok: false, code: "bad-request", detail: body.error.message },
      { status: 400 },
    );
  }
  const nextRole: Role = body.data.role;

  if (existing.role === "OWNER" && nextRole !== "OWNER") {
    const owners = await countOwners();
    if (owners <= 1) {
      return NextResponse.json(
        {
          ok: false,
          code: "last-owner",
          detail: "cannot demote the last OWNER — promote someone else first",
        },
        { status: 400 },
      );
    }
  }

  const updated = await prisma.user.update({
    where: { id },
    data: { role: nextRole },
  });
  await recordAudit(session.userId, "CONFIG_WRITE", {
    kind: "user.role.update",
    targetId: id,
    targetDiscordId: existing.discordId,
    from: existing.role,
    to: nextRole,
  });
  return NextResponse.json({ ok: true, user: { id: updated.id, role: updated.role } });
}

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
  if (id === session.userId) {
    return NextResponse.json(
      {
        ok: false,
        code: "self-delete",
        detail: "refusing to delete the currently signed-in user",
      },
      { status: 400 },
    );
  }
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json(
      { ok: false, code: "not-found", detail: `no user with id=${id}` },
      { status: 404 },
    );
  }
  if (existing.role === "OWNER") {
    const owners = await countOwners();
    if (owners <= 1) {
      return NextResponse.json(
        {
          ok: false,
          code: "last-owner",
          detail: "cannot delete the last OWNER",
        },
        { status: 400 },
      );
    }
  }
  await prisma.user.delete({ where: { id } });
  await recordAudit(session.userId, "CONFIG_WRITE", {
    kind: "user.delete",
    targetId: id,
    targetDiscordId: existing.discordId,
    wasRole: existing.role,
  });
  return NextResponse.json({ ok: true, id });
}
