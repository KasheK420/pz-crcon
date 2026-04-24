/**
 * `POST /api/admin/mods/import` — bulk import a Steam Workshop collection
 * into the mod list (ADMIN+).
 *
 * Body:
 *   { collectionId: string, replaceExisting?: boolean, applyToIni?: boolean }
 *
 * When `replaceExisting=true` the existing mod list is wiped first — use
 * this to "adopt a curated collection as my entire mod list". When false,
 * we append missing rows and skip duplicates.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { atLeast } from "@/lib/auth/role";
import { checkCsrf } from "@/lib/csrf/check";
import { importCollection } from "@/lib/pz/mods";
import { recordAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/db/client";

export const dynamic = "force-dynamic";

const Body = z.object({
  collectionId: z.string().min(1),
  replaceExisting: z.boolean().optional(),
  applyToIni: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !atLeast(session.role, "ADMIN")) {
    return NextResponse.json({ ok: false, code: "forbidden" }, { status: 403 });
  }
  const csrf = checkCsrf(req);
  if (!csrf.ok) {
    return NextResponse.json({ ok: false, code: "csrf", reason: csrf.reason }, { status: 403 });
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
  const body = Body.safeParse(raw);
  if (!body.success) {
    return NextResponse.json(
      { ok: false, code: "bad-request", detail: body.error.message },
      { status: 400 },
    );
  }
  const result = await importCollection({
    collectionId: body.data.collectionId,
    replaceExisting: body.data.replaceExisting ?? false,
    applyToIni: body.data.applyToIni,
  });
  if (!result.ok) {
    const status =
      result.code === "invalid-input"
        ? 400
        : result.code === "steam-unreachable" || result.code === "steam-rejected"
          ? 502
          : 409;
    return NextResponse.json(result, { status });
  }
  await recordAudit(session.userId, "CONFIG_WRITE", {
    kind: "mod.import",
    collectionId: body.data.collectionId,
    replaced: result.replaced,
    addedCount: result.addedCount,
    skippedCount: result.skippedCount,
    steamMisses: result.steamMisses.length,
    iniApplied: result.iniApplied,
  });
  await prisma.adminAction
    .create({
      data: {
        userId: session.userId,
        kind: "MOD_COLLECTION_IMPORTED",
        target: body.data.collectionId,
        details: {
          addedCount: result.addedCount,
          skippedCount: result.skippedCount,
          replaced: result.replaced,
        },
      },
    })
    .catch(() => {});
  return NextResponse.json(result);
}
