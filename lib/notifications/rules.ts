/**
 * Per-event notification rules.
 *
 * Truth lives in the `Setting` KV table at key `discord.rules`. The table
 * value is a `Record<EventKey, boolean>`; anything missing from the stored
 * map falls back to `DEFAULT_RULES`.
 *
 * Keeping the rules in Postgres (rather than env vars) means operators
 * can toggle them from the Settings UI without a redeploy — Phase 3
 * requirement.
 */

import { prisma } from "@/lib/db/client";

export type EventKey =
  | "player.join"
  | "player.leave"
  | "player.death"
  | "player.ban"
  | "player.kick"
  | "lifecycle.restart"
  | "lifecycle.stopped"
  | "lifecycle.started"
  | "backup.created"
  | "backup.failed"
  | "mod.added"
  | "mod.removed"
  | "mod.stale";

export const EVENT_CATALOG: Array<{
  key: EventKey;
  label: string;
  defaultEnabled: boolean;
}> = [
  { key: "player.join", label: "Player joined", defaultEnabled: true },
  { key: "player.leave", label: "Player left", defaultEnabled: false },
  { key: "player.death", label: "Player died", defaultEnabled: true },
  { key: "player.ban", label: "Player banned", defaultEnabled: true },
  { key: "player.kick", label: "Player kicked", defaultEnabled: true },
  { key: "lifecycle.restart", label: "Server restart", defaultEnabled: true },
  { key: "lifecycle.stopped", label: "Server stopped", defaultEnabled: true },
  { key: "lifecycle.started", label: "Server started", defaultEnabled: true },
  { key: "backup.created", label: "Backup created", defaultEnabled: false },
  { key: "backup.failed", label: "Backup failed", defaultEnabled: true },
  { key: "mod.added", label: "Mod added", defaultEnabled: false },
  { key: "mod.removed", label: "Mod removed", defaultEnabled: false },
  { key: "mod.stale", label: "Lua mod went silent", defaultEnabled: true },
];

export const DEFAULT_RULES: Record<EventKey, boolean> = Object.fromEntries(
  EVENT_CATALOG.map((e) => [e.key, e.defaultEnabled]),
) as Record<EventKey, boolean>;

const RULES_KEY = "discord.rules";
const WEBHOOK_KEY = "discord.webhook";

export interface DiscordSettings {
  webhookUrl: string | null;
  username: string | null;
  avatarUrl: string | null;
  rules: Record<EventKey, boolean>;
}

async function readSetting(key: string): Promise<unknown | null> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row?.value ?? null;
}

async function writeSetting(
  key: string,
  value: unknown,
  userId?: string | null,
): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    update: { value: value as never, updatedBy: userId ?? null },
    create: { key, value: value as never, updatedBy: userId ?? null },
  });
}

export async function loadDiscordSettings(): Promise<DiscordSettings> {
  const [rulesRaw, webhookRaw] = await Promise.all([
    readSetting(RULES_KEY),
    readSetting(WEBHOOK_KEY),
  ]);
  const stored: Record<string, unknown> =
    rulesRaw && typeof rulesRaw === "object"
      ? (rulesRaw as Record<string, unknown>)
      : {};
  const rules = { ...DEFAULT_RULES };
  for (const key of Object.keys(DEFAULT_RULES) as EventKey[]) {
    const v = stored[key];
    if (typeof v === "boolean") rules[key] = v;
  }
  const wh: Partial<DiscordSettings> =
    webhookRaw && typeof webhookRaw === "object"
      ? (webhookRaw as Partial<DiscordSettings>)
      : {};
  // Env var provides a default webhook URL if no Setting row exists yet.
  const envWebhook = process.env.DISCORD_WEBHOOK_URL ?? null;
  return {
    webhookUrl: wh.webhookUrl ?? envWebhook ?? null,
    username: wh.username ?? null,
    avatarUrl: wh.avatarUrl ?? null,
    rules,
  };
}

export async function saveDiscordSettings(
  patch: Partial<DiscordSettings>,
  userId: string,
): Promise<DiscordSettings> {
  if (patch.rules !== undefined) {
    await writeSetting(RULES_KEY, patch.rules, userId);
  }
  if (
    patch.webhookUrl !== undefined ||
    patch.username !== undefined ||
    patch.avatarUrl !== undefined
  ) {
    const current = await loadDiscordSettings();
    await writeSetting(
      WEBHOOK_KEY,
      {
        webhookUrl: patch.webhookUrl ?? current.webhookUrl,
        username: patch.username ?? current.username,
        avatarUrl: patch.avatarUrl ?? current.avatarUrl,
      },
      userId,
    );
  }
  return loadDiscordSettings();
}

/** For public `GET`: mask the webhook URL so non-OWNER roles don't see the secret. */
export function redactWebhookUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    // Discord webhook paths: /api/webhooks/<id>/<token>
    if (parts.length >= 4 && parts[1] === "webhooks") {
      parts[3] = parts[3].slice(0, 4) + "…";
    }
    u.pathname = "/" + parts.join("/");
    return u.toString();
  } catch {
    return url.slice(0, 10) + "…";
  }
}
