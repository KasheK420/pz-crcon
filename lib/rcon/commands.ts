export interface RconCommandSpec {
  name: string;
  signature: string;
  description: string;
  /** Lowest role allowed to invoke. */
  requires: "MODERATOR" | "ADMIN" | "OWNER";
}

export const RCON_COMMANDS: RconCommandSpec[] = [
  { name: "players", signature: "players", description: "List connected players", requires: "MODERATOR" },
  { name: "kick", signature: 'kick "name" [reason]', description: "Disconnect a player", requires: "MODERATOR" },
  { name: "ban", signature: 'ban "name" [reason] [-ip]', description: "Permanent ban", requires: "ADMIN" },
  { name: "unban", signature: 'unban "name"', description: "Remove a ban", requires: "ADMIN" },
  { name: "additem", signature: 'additem "name" "item" [count]', description: "Give item", requires: "ADMIN" },
  { name: "setaccesslevel", signature: 'setaccesslevel "name" "level"', description: "Set in-game admin level", requires: "OWNER" },
  { name: "chopper", signature: "chopper", description: "Trigger helicopter event", requires: "MODERATOR" },
  { name: "gunshot", signature: "gunshot", description: "Play a gunshot sound", requires: "MODERATOR" },
  { name: "servermsg", signature: 'servermsg "message"', description: "Broadcast", requires: "MODERATOR" },
  { name: "save", signature: "save", description: "Save the world", requires: "ADMIN" },
  { name: "quit", signature: "quit", description: "Graceful shutdown", requires: "OWNER" },
  { name: "addxp", signature: 'addxp "name" "perk=lvl"', description: "Grant XP", requires: "ADMIN" },
  { name: "teleport", signature: 'teleport "src" "dst"', description: "Teleport one player to another", requires: "ADMIN" },
  { name: "teleportto", signature: "teleportto x,y,z", description: "Teleport self to coords", requires: "ADMIN" },
  { name: "godmode", signature: 'godmode "name" -true|-false', description: "Toggle god mode", requires: "ADMIN" },
  { name: "invisible", signature: 'invisible "name" -true|-false', description: "Toggle visibility", requires: "ADMIN" },
  { name: "noclip", signature: 'noclip "name" -true|-false', description: "Toggle noclip", requires: "ADMIN" },
  { name: "reloadlua", signature: 'reloadlua "file"', description: "Reload a Lua file", requires: "OWNER" },
  { name: "changeoption", signature: 'changeoption "name" "value"', description: "Change a server option live", requires: "ADMIN" },
];

export function findCommand(name: string): RconCommandSpec | undefined {
  return RCON_COMMANDS.find((c) => c.name === name);
}
