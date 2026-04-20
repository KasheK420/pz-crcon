import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { rconExecute } from "@/lib/rcon/client";
import { buildCommand } from "@/lib/rcon/quote";
import { prisma } from "@/lib/db/client";
import { publish } from "@/lib/ws/server";
import { atLeast, type Role } from "@/lib/auth/role";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save") }),
  z.object({ action: z.literal("servermsg"), message: z.string().min(1).max(200) }),
  z.object({ action: z.literal("kickall"), reason: z.string().max(200).optional() }),
]);

const REQUIRED_ROLE: Record<string, Role> = {
  save: "ADMIN",
  servermsg: "MODERATOR",
  kickall: "ADMIN",
};

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
  const data = parsed.data;
  const required = REQUIRED_ROLE[data.action];
  if (required && !atLeast(session.role, required)) {
    return NextResponse.json({ error: "FORBIDDEN_COMMAND" }, { status: 403 });
  }

  let command: string;
  if (data.action === "save") {
    command = "save";
  } else if (data.action === "servermsg") {
    command = buildCommand("servermsg", [data.message]);
  } else {
    command = buildCommand("kickall", [data.reason ?? "Admin kick"]);
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
      kind: `quick_${data.action}`,
      target: data.action,
      details: { command, output },
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
