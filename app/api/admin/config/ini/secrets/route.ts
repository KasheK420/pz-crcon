/**
 * `GET /api/admin/config/ini/secrets` — OWNER-only reveal endpoint.
 *
 * Returns the raw values for every INI key marked `secret: true` in the
 * descriptors (RCONPassword, Password, DiscordToken). The UI's
 * `SecretsReveal` component calls this on demand; the main `/ini`
 * route always returns `__REDACTED__` for these keys for non-owners.
 */

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { atLeast } from "@/lib/auth/role";
import { readServerIni } from "@/lib/pz/config-reader";
import { INI_DESCRIPTORS } from "@/lib/pz/ini-descriptors";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session || !atLeast(session.role, "OWNER")) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const r = await readServerIni();
  if (!r.ok) {
    return NextResponse.json(
      { ok: false, error: r.error },
      { status: 503 },
    );
  }
  const secrets: Record<string, string> = {};
  for (const e of r.parsed?.entries ?? []) {
    if (INI_DESCRIPTORS[e.key]?.secret) {
      secrets[e.key] = String(e.value);
    }
  }
  return NextResponse.json({ ok: true, secrets });
}
