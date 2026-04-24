import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { rconExecute } from "@/lib/rcon/client";
import { prisma } from "@/lib/db/client";
import { buildCommand } from "@/lib/rcon/quote";
import { publish } from "@/lib/ws/server";

const Body = z.object({
  reason: z.string().max(200).optional(),
  /** Ban duration in hours. Omit or set to 0 for a permanent ban. */
  durationHours: z.number().int().min(0).max(24 * 365).optional(),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ playerId: string }> }
) {
  let session;
  try {
    session = await requireRole("ADMIN");
  } catch (e) {
    const status = (e as Error).message === "FORBIDDEN" ? 403 : 401;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
  const { playerId } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }
  const reason = parsed.data.reason?.trim() || "Banned by admin";
  const durationHours = parsed.data.durationHours ?? 0;
  const banExpiresAt =
    durationHours > 0 ? new Date(Date.now() + durationHours * 3_600_000) : null;

  const player = await prisma.player.findUnique({ where: { id: playerId } });
  if (!player) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const command = buildCommand("ban", [player.name, reason]);
  let output: string;
  try {
    output = await rconExecute(command);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }

  await prisma.player.update({
    where: { id: player.id },
    data: {
      isBanned: true,
      isOnline: false,
      banReason: reason,
      banByUserId: session.userId,
      banExpiresAt,
    },
  });
  await prisma.adminAction.create({
    data: {
      userId: session.userId,
      kind: "player_ban",
      target: player.name,
      details: { playerId: player.id, reason, command, output, durationHours, banExpiresAt: banExpiresAt?.toISOString() ?? null },
    },
  });
  publish("rcon:output", {
    user: session.discordId,
    command,
    output,
    ts: Date.now(),
  });
  publish("events:admin", {
    kind: "admin-action",
    action: {
      kind: "PLAYER_BANNED",
      target: player.name,
      details: { playerId: player.id, reason },
    },
  });
  return NextResponse.json({ ok: true, output });
}
