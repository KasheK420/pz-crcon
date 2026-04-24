/**
 * `GET /api/admin/settings` — environment-backed panel settings (VIEWER+).
 *
 * Today panel-level config lives in env vars (PUBLIC_SERVER_NAME,
 * PUBLIC_SERVER_ADDRESS, etc.) rather than a DB table. This route surfaces
 * the *current* values to the UI so operators don't have to SSH to check
 * what's deployed. Editing is intentionally NOT supported from the UI —
 * changing env vars requires a container restart, so we point the user
 * at the compose file instead.
 *
 * Sensitive keys (URLs with credentials, secrets) are masked for all
 * roles including OWNER; operators who need those values read them
 * from the compose file on disk.
 */

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { atLeast } from "@/lib/auth/role";

export const dynamic = "force-dynamic";

interface SettingEntry {
  key: string;
  label: string;
  value: string | null;
  group: "public" | "server" | "rcon" | "discord" | "webhook";
  secret?: boolean;
  description: string;
}

function mask(v: string | undefined): string | null {
  if (!v) return null;
  if (v.length <= 8) return "••••••";
  return `${v.slice(0, 4)}…${v.slice(-2)}`;
}

export async function GET() {
  const session = await getSession();
  if (!session || !atLeast(session.role, "VIEWER")) {
    return NextResponse.json({ ok: false, code: "forbidden" }, { status: 403 });
  }

  const isOwner = atLeast(session.role, "OWNER");

  const entries: SettingEntry[] = [
    {
      key: "PUBLIC_SERVER_NAME",
      label: "Server name",
      value: process.env.PUBLIC_SERVER_NAME ?? null,
      group: "public",
      description: "Shown on the public landing page header.",
    },
    {
      key: "PUBLIC_SERVER_ADDRESS",
      label: "Server address",
      value: process.env.PUBLIC_SERVER_ADDRESS ?? null,
      group: "public",
      description: "e.g. pz.example.com:16261 — copy-to-clipboard in Join Info.",
    },
    {
      key: "PUBLIC_MAX_PLAYERS",
      label: "Max players",
      value: process.env.PUBLIC_MAX_PLAYERS ?? null,
      group: "public",
      description: "Displayed as X / Y on the public page.",
    },
    {
      key: "PUBLIC_DISCORD_URL",
      label: "Discord invite URL",
      value: process.env.PUBLIC_DISCORD_URL ?? null,
      group: "public",
      description: "Public Discord join link surfaced on the landing page.",
    },
    {
      key: "PUBLIC_WORKSHOP_COLLECTION_URL",
      label: "Workshop collection URL",
      value: process.env.PUBLIC_WORKSHOP_COLLECTION_URL ?? null,
      group: "public",
      description: "Optional Steam Workshop collection link shown on the mod grid.",
    },
    {
      key: "PZ_CONTAINER_NAME",
      label: "PZ container name",
      value: process.env.PZ_CONTAINER_NAME ?? "pz-server",
      group: "server",
      description: "Docker container name of the PZ dedicated server.",
    },
    {
      key: "PZ_CONFIG_DIR",
      label: "Config dir",
      value: process.env.PZ_CONFIG_DIR ?? "/pz-data/Server",
      group: "server",
      description: "Directory where server.ini + sandbox live.",
    },
    {
      key: "PZ_SERVER_PREFIX",
      label: "Server prefix (override)",
      value: process.env.PZ_SERVER_PREFIX ?? null,
      group: "server",
      description: "Fallback for detecting the SERVERNAME env of pz-server.",
    },
    {
      key: "RCON_HOST",
      label: "RCON host",
      value: process.env.RCON_HOST ?? null,
      group: "rcon",
      description: "Hostname of the RCON endpoint exposed by pz-server.",
    },
    {
      key: "RCON_PORT",
      label: "RCON port",
      value: process.env.RCON_PORT ?? null,
      group: "rcon",
      description: "UDP port for RCON.",
    },
    {
      key: "RCON_PASSWORD",
      label: "RCON password",
      value: isOwner
        ? mask(process.env.RCON_PASSWORD)
        : "••••••",
      group: "rcon",
      secret: true,
      description: "Shared secret for panel ↔ PZ RCON. Owners see masked.",
    },
    {
      key: "WEBHOOK_HMAC_SECRET",
      label: "Webhook HMAC secret",
      value: isOwner
        ? mask(process.env.WEBHOOK_HMAC_SECRET)
        : "••••••",
      group: "webhook",
      secret: true,
      description:
        "Shared with the Lua companion mod — used to sign webhook payloads. Rotate via redeploy.",
    },
    {
      key: "DISCORD_ADMIN_IDS",
      label: "Discord admin IDs",
      value: process.env.DISCORD_ADMIN_IDS ?? null,
      group: "discord",
      description: "Comma-separated Discord user IDs — first is OWNER, rest ADMIN.",
    },
  ];

  return NextResponse.json({
    ok: true,
    entries,
    note:
      "Settings are environment variables. To change them, edit the compose .env file and redeploy — changes do not survive a hot edit.",
  });
}
