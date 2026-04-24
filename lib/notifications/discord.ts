/**
 * Discord outgoing-webhook client.
 *
 * Renders domain events into Discord embeds and POSTs them to the
 * configured webhook URL. Swallows non-2xx responses — we never want a
 * Discord outage to backpressure game-logic code paths. Surface errors
 * via the logger and (Phase 3 TODO) publish a `notifications.failed`
 * event for the admin panel.
 */

import { loadDiscordSettings, type EventKey } from "./rules";
import { getLogger } from "@/lib/logger";

const log = () => getLogger().child({ mod: "notifications/discord" });

const COLOURS: Record<EventKey, number> = {
  "player.join": 0x57f287, // green
  "player.leave": 0x99aab5, // grey
  "player.death": 0xed4245, // red
  "player.ban": 0xeb459e, // pink
  "player.kick": 0xfee75c, // yellow
  "lifecycle.started": 0x57f287,
  "lifecycle.stopped": 0x99aab5,
  "lifecycle.restart": 0xfee75c,
  "backup.created": 0x57f287,
  "backup.failed": 0xed4245,
  "mod.added": 0x57f287,
  "mod.removed": 0x99aab5,
  "mod.stale": 0xeb459e,
};

export interface EmbedInput {
  event: EventKey;
  title: string;
  description?: string;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: string;
}

function buildPayload(
  input: EmbedInput,
  opts: { username?: string | null; avatarUrl?: string | null },
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    embeds: [
      {
        title: input.title,
        description: input.description,
        color: COLOURS[input.event] ?? 0x5865f2,
        timestamp: new Date().toISOString(),
        fields: input.fields,
        footer: input.footer ? { text: input.footer } : { text: "pz-crcon" },
      },
    ],
  };
  if (opts.username) payload.username = opts.username;
  if (opts.avatarUrl) payload.avatar_url = opts.avatarUrl;
  return payload;
}

export async function sendDiscordEmbed(input: EmbedInput): Promise<{
  sent: boolean;
  reason?: string;
}> {
  const settings = await loadDiscordSettings();
  if (!settings.webhookUrl) {
    return { sent: false, reason: "no-webhook" };
  }
  if (!settings.rules[input.event]) {
    return { sent: false, reason: "rule-disabled" };
  }
  const body = JSON.stringify(
    buildPayload(input, {
      username: settings.username,
      avatarUrl: settings.avatarUrl,
    }),
  );
  try {
    const res = await fetch(settings.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      // Short timeout — Discord is usually <200ms; tail latencies hurt tick loops.
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      log().warn({ status: res.status, event: input.event }, "discord webhook non-2xx");
      return { sent: false, reason: `http-${res.status}` };
    }
    return { sent: true };
  } catch (e) {
    log().warn(
      { err: e instanceof Error ? e.message : String(e), event: input.event },
      "discord webhook fetch failed",
    );
    return { sent: false, reason: "network-error" };
  }
}

/**
 * Send a plain test embed — used by the Settings "Send test embed" button.
 * Bypasses the rules check so operators can verify the webhook URL is
 * correct even when every rule is disabled.
 */
export async function sendTestEmbed(note: string): Promise<{
  sent: boolean;
  reason?: string;
}> {
  const settings = await loadDiscordSettings();
  if (!settings.webhookUrl) return { sent: false, reason: "no-webhook" };
  const body = JSON.stringify(
    buildPayload(
      {
        event: "lifecycle.started",
        title: "pz-crcon test notification",
        description: note || "If you see this, the webhook is wired up correctly.",
      },
      { username: settings.username, avatarUrl: settings.avatarUrl },
    ),
  );
  try {
    const res = await fetch(settings.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return { sent: false, reason: `http-${res.status}` };
    return { sent: true };
  } catch (e) {
    return {
      sent: false,
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}
