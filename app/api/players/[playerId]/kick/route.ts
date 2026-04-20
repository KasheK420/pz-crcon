import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { rconExecute } from "@/lib/rcon/client";
import { prisma } from "@/lib/db/client";
import { buildCommand } from "@/lib/rcon/quote";
import { publish } from "@/lib/ws/server";

const Body = z.object({
  reason: z.string().max(200).optional(),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ playerId: string }> }
) {
  let session;
  try {
    session = await requireRole("MODERATOR");
  } catch (e) {
    const status = (e as Error).message === "FORBIDDEN" ? 403 : 401;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
  const { playerId } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }
  const reason = parsed.data.reason?.trim() || "Kicked by admin";

  const player = await prisma.player.findUnique({ where: { id: playerId } });
  if (!player) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const command = buildCommand("kick", [player.name, reason]);
  let output: string;
  try {
    output = await rconExecute(command);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }

  await prisma.adminAction.create({
    data: {
      userId: session.userId,
      kind: "player_kick",
      target: player.name,
      details: { playerId: player.id, reason, command, output },
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
