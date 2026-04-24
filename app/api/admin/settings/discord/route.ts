/**
 * `GET /api/admin/settings/discord` — current Discord config (ADMIN+),
 *                                      webhook masked for non-OWNER.
 * `PUT /api/admin/settings/discord` — update webhook + rules (OWNER).
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { atLeast } from "@/lib/auth/role";
import { checkCsrf } from "@/lib/csrf/check";
import {
  DEFAULT_RULES,
  EVENT_CATALOG,
  loadDiscordSettings,
  redactWebhookUrl,
  saveDiscordSettings,
  type EventKey,
} from "@/lib/notifications/rules";
import { recordAudit } from "@/lib/server/audit";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session || !atLeast(session.role, "ADMIN")) {
    return NextResponse.json({ ok: false, code: "forbidden" }, { status: 403 });
  }
  const isOwner = atLeast(session.role, "OWNER");
  const s = await loadDiscordSettings();
  return NextResponse.json({
    ok: true,
    webhookUrl: isOwner ? s.webhookUrl : redactWebhookUrl(s.webhookUrl),
    webhookMasked: !isOwner,
    username: s.username,
    avatarUrl: s.avatarUrl,
    rules: s.rules,
    catalog: EVENT_CATALOG,
    defaults: DEFAULT_RULES,
  });
}

const Body = z.object({
  webhookUrl: z.string().url().nullable().optional(),
  username: z.string().max(80).nullable().optional(),
  avatarUrl: z.string().url().nullable().optional(),
  rules: z.record(z.string(), z.boolean()).optional(),
});

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session || !atLeast(session.role, "OWNER")) {
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

  // Validate the rule keys are all known.
  if (body.data.rules) {
    const known = new Set(EVENT_CATALOG.map((e) => e.key));
    for (const k of Object.keys(body.data.rules)) {
      if (!known.has(k as EventKey)) {
        return NextResponse.json(
          { ok: false, code: "bad-request", detail: `unknown rule key: ${k}` },
          { status: 400 },
        );
      }
    }
  }

  const saved = await saveDiscordSettings(
    {
      webhookUrl: body.data.webhookUrl ?? undefined,
      username: body.data.username ?? undefined,
      avatarUrl: body.data.avatarUrl ?? undefined,
      rules: body.data.rules as Record<EventKey, boolean> | undefined,
    },
    session.userId,
  );
  await recordAudit(session.userId, "CONFIG_WRITE", {
    kind: "settings.discord.update",
    webhookChanged: body.data.webhookUrl !== undefined,
    rulesChanged: Boolean(body.data.rules),
  });
  return NextResponse.json({
    ok: true,
    webhookUrl: saved.webhookUrl, // OWNER sees unmasked
    username: saved.username,
    avatarUrl: saved.avatarUrl,
    rules: saved.rules,
  });
}
