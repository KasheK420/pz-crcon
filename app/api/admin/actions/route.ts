import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";

export async function GET() {
  try {
    await requireRole("VIEWER");
  } catch (e) {
    const status = (e as Error).message === "FORBIDDEN" ? 403 : 401;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
  const rows = await prisma.adminAction.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      user: {
        select: { username: true, discordId: true },
      },
    },
  });
  return NextResponse.json({
    actions: rows.map((a) => ({
      id: a.id,
      kind: a.kind,
      target: a.target,
      details: a.details,
      createdAt: a.createdAt,
      user: {
        username: a.user.username,
        discordId: a.user.discordId,
      },
    })),
  });
}
