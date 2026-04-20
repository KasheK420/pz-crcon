import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { rconExecute } from "@/lib/rcon/client";
import { prisma } from "@/lib/db/client";
import { buildCommand } from "@/lib/rcon/quote";
import { publish } from "@/lib/ws/server";

export async function POST(
  _req: Request,
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

  const player = await prisma.player.findUnique({ where: { id: playerId } });
  if (!player) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const command = buildCommand("unban", [player.name]);
  let output: string;
  try {
    output = await rconExecute(command);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }

  await prisma.player.update({
    where: { id: player.id },
    data: {
      isBanned: false,
      banReason: null,
      banByUserId: null,
    },
  });
  await prisma.adminAction.create({
    data: {
      userId: session.userId,
      kind: "player_unban",
      target: player.name,
      details: { playerId: player.id, command, output },
    },
  });
  publish("rcon:output", {
    user: session.discordId,
    command,
    output,
    ts: Date.now(),
  });
  return NextResponse.json({ ok: true, output });
}
