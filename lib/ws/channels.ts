import type { Role } from "@/lib/auth/role";
import { atLeast } from "@/lib/auth/role";

export type Channel =
  | "events:public"
  | "events:admin"
  | "players:positions"
  | "rcon:output"
  | "logs:server";

export const CHANNEL_MIN_ROLE: Record<Channel, Role | null> = {
  "events:public": null,
  "events:admin": "VIEWER",
  "players:positions": "VIEWER",
  "rcon:output": "MODERATOR",
  "logs:server": "MODERATOR",
};

export function canSubscribe(channel: Channel, role: Role | null): boolean {
  const min = CHANNEL_MIN_ROLE[channel];
  if (min === null) return true;
  if (!role) return false;
  return atLeast(role, min);
}
