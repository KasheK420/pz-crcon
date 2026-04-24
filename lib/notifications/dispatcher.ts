/**
 * Wires the notification rules + Discord sender into the existing
 * `events:admin` WS channel so Phase 3/4 events fan out without any
 * route-level code knowing about Discord.
 *
 * Two supported event envelopes (published by existing code):
 *
 *   { kind: "world.death" | "world.join" | … , event: {...} }     (Phase 4)
 *   { kind: "admin-action", action: { kind, target, details } }   (Phase 1.x)
 *
 * Anything unknown is ignored silently — new event kinds opt in by
 * adding a case below.
 */

import { subscribeLocal } from "@/lib/ws/server";
import { sendDiscordEmbed } from "./discord";
import type { EventKey } from "./rules";
import { getLogger } from "@/lib/logger";

const log = () => getLogger().child({ mod: "notifications/dispatcher" });

let _installed = false;

interface WorldEnvelope {
  kind: string;
  event?: {
    kind?: string;
    name?: string;
    region?: string;
    meta?: Record<string, unknown>;
  };
  action?: {
    kind?: string;
    target?: string;
    details?: Record<string, unknown>;
  };
}

function buildEmbed(env: WorldEnvelope):
  | { key: EventKey; title: string; description?: string; fields?: Array<{ name: string; value: string; inline?: boolean }> }
  | null
{
  if (env.kind?.startsWith("world.")) {
    const sub = env.kind.slice(6);
    const ev = env.event ?? {};
    const who = ev.name ?? "someone";
    const region = ev.region ? ` in **${ev.region}**` : "";
    if (sub === "death") {
      const cause = (ev.meta?.cause as string | undefined) ?? "unknown";
      return {
        key: "player.death",
        title: `💀 ${who} died`,
        description: `Cause: \`${cause}\`${region}.`,
      };
    }
    if (sub === "join") {
      return {
        key: "player.join",
        title: `🧟 ${who} joined`,
        description: region ? `Spawned${region}.` : undefined,
      };
    }
    if (sub === "leave") {
      return {
        key: "player.leave",
        title: `👋 ${who} left`,
      };
    }
    if (sub === "mod_stale") {
      return {
        key: "mod.stale",
        title: "⚠ Lua mod stopped reporting",
        description:
          "No heartbeats from the companion mod for over 2 minutes. The live map will go cold until it comes back.",
      };
    }
    return null;
  }

  if (env.kind === "admin-action") {
    const act = env.action ?? {};
    const target = act.target ?? "unknown";
    // Accept both UPPERCASE (new) and lowercase (legacy) kinds from the
    // existing ban/kick routes, which historically wrote `player_ban` etc.
    const kind = (act.kind ?? "").toUpperCase();
    switch (kind) {
      case "PLAYER_KICK":
      case "PLAYER_KICKED":
        return { key: "player.kick", title: `👢 Kicked ${target}` };
      case "PLAYER_BAN":
      case "PLAYER_BANNED":
        return {
          key: "player.ban",
          title: `🔨 Banned ${target}`,
          description: (act.details?.reason as string | undefined) ?? undefined,
        };
      case "BACKUP_CREATED":
        return {
          key: "backup.created",
          title: "💾 Backup created",
          description: String(act.target),
        };
      case "MOD_ADDED":
        return {
          key: "mod.added",
          title: "🧩 Mod added",
          description: String(act.target),
        };
      case "MOD_REMOVED":
        return {
          key: "mod.removed",
          title: "🗑 Mod removed",
          description: String(act.target),
        };
      default:
        return null;
    }
  }
  return null;
}

export function installNotificationsDispatcher(): void {
  if (_installed) return;
  _installed = true;

  subscribeLocal("events:admin", async (payload: unknown) => {
    const env = payload as WorldEnvelope | null;
    if (!env || typeof env !== "object") return;
    const embed = buildEmbed(env);
    if (!embed) return;
    const res = await sendDiscordEmbed({
      event: embed.key,
      title: embed.title,
      description: embed.description,
      fields: embed.fields,
    });
    if (!res.sent && res.reason && res.reason !== "rule-disabled" && res.reason !== "no-webhook") {
      log().debug({ reason: res.reason, event: embed.key }, "discord send skipped");
    }
  });

  log().info("notifications dispatcher installed");
}
