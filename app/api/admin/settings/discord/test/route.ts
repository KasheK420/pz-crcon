/**
 * `POST /api/admin/settings/discord/test` — fire a test embed through the
 * configured webhook, bypassing per-event rules (OWNER only, CSRF).
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { atLeast } from "@/lib/auth/role";
import { checkCsrf } from "@/lib/csrf/check";
import { sendTestEmbed } from "@/lib/notifications/discord";
import { recordAudit } from "@/lib/server/audit";

export const dynamic = "force-dynamic";

const Body = z.object({
  note: z.string().max(500).optional(),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !atLeast(session.role, "OWNER")) {
    return NextResponse.json({ ok: false, code: "forbidden" }, { status: 403 });
  }
  const csrf = checkCsrf(req);
  if (!csrf.ok) {
    return NextResponse.json({ ok: false, code: "csrf", reason: csrf.reason }, { status: 403 });
  }
  let raw: unknown = {};
  try {
    const text = await req.text();
    raw = text ? JSON.parse(text) : {};
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
  const result = await sendTestEmbed(body.data.note ?? "");
  await recordAudit(session.userId, "CONFIG_WRITE", {
    kind: "settings.discord.test",
    sent: result.sent,
    reason: result.reason,
  });
  return NextResponse.json(result, { status: result.sent ? 200 : 502 });
}
