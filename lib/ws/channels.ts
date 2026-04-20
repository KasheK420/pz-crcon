import type { Role } from "@/lib/auth/role";
import { atLeast } from "@/lib/auth/role";

export type Channel =
  | "events:public"
  | "events:admin"
  | "players:positions"
  | "rcon:output"
  | "logs:server"
  | "server:lifecycle";

export const CHANNEL_MIN_ROLE: Record<Channel, Role | null> = {
  "events:public": null,
  "events:admin": "VIEWER",
  "players:positions": "VIEWER",
  "rcon:output": "MODERATOR",
  "logs:server": "MODERATOR",
  "server:lifecycle": "VIEWER",
};

/**
 * Typed payload for `server:lifecycle`. Broadcast by the lifecycle
 * orchestrator on every phase change. `at` is a wall-clock ms timestamp
 * so clients can render countdowns without trusting their own drift.
 */
export interface LifecyclePayload {
  phase: "idle" | "warning" | "saving" | "stopping" | "starting";
  detail?: string;
  at: number;
}

export function canSubscribe(channel: Channel, role: Role | null): boolean {
  const min = CHANNEL_MIN_ROLE[channel];
  if (min === null) return true;
  if (!role) return false;
  return atLeast(role, min);
}
