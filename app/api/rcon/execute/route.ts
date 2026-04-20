import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { rconExecute } from "@/lib/rcon/client";
import { findCommand } from "@/lib/rcon/commands";
import { atLeast } from "@/lib/auth/role";
import { prisma } from "@/lib/db/client";
import { publish } from "@/lib/ws/server";

const Body = z.object({ command: z.string().min(1).max(500) });

export async function POST(req: Request) {
  let session;
  try {
    session = await requireRole("MODERATOR");
  } catch (e) {
    const status = (e as Error).message === "FORBIDDEN" ? 403 : 401;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }
  const { command } = parsed.data;
  const head = command.trim().split(/\s+/)[0];
  const spec = findCommand(head);
  if (spec && !atLeast(session.role, spec.requires)) {
    return NextResponse.json({ error: "FORBIDDEN_COMMAND" }, { status: 403 });
  }
  let output: string;
  try {
    output = await rconExecute(command);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
  await prisma.adminAction.create({
    data: {
      userId: session.userId,
      kind: "rcon_exec",
      target: head,
      details: { command, outputBytes: output.length },
    },
  });
  publish("rcon:output", {
    user: session.discordId,
    command,
    output,
    ts: Date.now(),
  });
  return NextResponse.json({ output });
}
