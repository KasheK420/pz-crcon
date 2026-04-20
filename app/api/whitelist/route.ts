import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { rconExecute } from "@/lib/rcon/client";
import { buildCommand } from "@/lib/rcon/quote";
import { getLogger } from "@/lib/logger";

const log = () => getLogger().child({ mod: "api/whitelist" });

const STEAM_ID_RE = /^7656119\d{10}$/;
const PENDING_PREFIX = "pending:";

const PostBody = z.object({
  steamId: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .refine((v) => STEAM_ID_RE.test(v), {
      message: "Steam ID must be a 17-digit SteamID64 starting with 7656119...",
    }),
  notes: z.string().max(500).optional(),
});

const DeleteBody = z.object({
  playerId: z.string().min(1),
});

/** GET /api/whitelist — list whitelisted players. */
export async function GET() {
  try {
    await requireRole("ADMIN");
  } catch (e) {
    const status = (e as Error).message === "FORBIDDEN" ? 403 : 401;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
  const rows = await prisma.player.findMany({
    where: { isWhitelisted: true },
    orderBy: [{ whitelistedAt: "desc" }, { lastSeen: "desc" }],
  });
  return NextResponse.json({
    players: rows.map((p) => ({
      id: p.id,
      steamId: p.steamId,
      name: p.name,
      isOnline: p.isOnline,
      isBanned: p.isBanned,
      lastSeen: p.lastSeen,
      whitelistedAt: p.whitelistedAt,
      whitelistedById: p.whitelistedById,
      notes: p.notes,
      isPending: p.steamId.startsWith(PENDING_PREFIX),
      hasRealName: !p.name.startsWith("Pending ("),
    })),
  });
}

/** POST /api/whitelist — add a Steam ID to the whitelist. */
export async function POST(req: Request) {
  let session;
  try {
    session = await requireRole("ADMIN");
  } catch (e) {
    const status = (e as Error).message === "FORBIDDEN" ? 403 : 401;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
  const parsed = PostBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "BAD_REQUEST",
        details: parsed.error.issues.map((i) => i.message).join("; "),
      },
      { status: 400 },
    );
  }
  const { steamId, notes } = parsed.data;
  const existing = await prisma.player.findUnique({ where: { steamId } });
  let player;
  let createdNew = false;
  if (existing) {
    player = await prisma.player.update({
      where: { id: existing.id },
      data: {
        isWhitelisted: true,
        whitelistedAt: new Date(),
        whitelistedById: session.userId,
        ...(notes ? { notes } : {}),
      },
    });
  } else {
    createdNew = true;
    player = await prisma.player.create({
      data: {
        steamId,
        name: `Pending (${steamId})`,
        isWhitelisted: true,
        whitelistedAt: new Date(),
        whitelistedById: session.userId,
        notes: notes ?? null,
      },
    });
  }

  await prisma.adminAction.create({
    data: {
      userId: session.userId,
      kind: "whitelist_add",
      target: steamId,
      details: { playerId: player.id, createdNew, name: player.name },
    },
  });

  log().info({ steamId, playerId: player.id, createdNew }, "whitelist add");

  return NextResponse.json({
    ok: true,
    player: {
      id: player.id,
      steamId: player.steamId,
      name: player.name,
      isWhitelisted: player.isWhitelisted,
      whitelistedAt: player.whitelistedAt,
    },
  });
}

/**
 * DELETE /api/whitelist — remove from whitelist. If the player has a real
 * (non-pending) name we also issue the RCON `removeuserfromwhitelist`
 * command so the live server forgets the entry.
 */
export async function DELETE(req: Request) {
  let session;
  try {
    session = await requireRole("ADMIN");
  } catch (e) {
    const status = (e as Error).message === "FORBIDDEN" ? 403 : 401;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
  const parsed = DeleteBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }
  const player = await prisma.player.findUnique({
    where: { id: parsed.data.playerId },
  });
  if (!player) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  // Only invoke RCON for "real" players (not pending placeholders).
  let rconOutput: string | null = null;
  let rconError: string | null = null;
  const isPending =
    player.name.startsWith("Pending (") || player.steamId.startsWith(PENDING_PREFIX);
  if (!isPending) {
    const command = buildCommand("removeuserfromwhitelist", [player.name]);
    try {
      rconOutput = await rconExecute(command);
    } catch (e) {
      rconError = String(e);
      log().warn({ err: e, name: player.name }, "rcon removeuserfromwhitelist failed");
    }
  }

  await prisma.player.update({
    where: { id: player.id },
    data: {
      isWhitelisted: false,
      whitelistedAt: null,
      whitelistedById: null,
    },
  });

  await prisma.adminAction.create({
    data: {
      userId: session.userId,
      kind: "whitelist_remove",
      target: player.steamId,
      details: {
        playerId: player.id,
        name: player.name,
        rconOutput,
        rconError,
        isPending,
      },
    },
  });

  return NextResponse.json({
    ok: true,
    rconInvoked: !isPending && rconError === null,
    rconError,
  });
}
