export type RconCategory =
  | "server"
  | "player"
  | "chat"
  | "world"
  | "moderation"
  | "whitelist"
  | "debug"
  | "replay";

export interface RconCommandSpec {
  name: string;
  signature: string;
  description: string;
  category: RconCategory;
  /** Lowest role allowed to invoke. */
  requires: "MODERATOR" | "ADMIN" | "OWNER";
  examples?: string[];
}

export const RCON_COMMANDS: RconCommandSpec[] = [
  // --- SERVER control ---
  {
    name: "quit",
    signature: "quit",
    description: "Gracefully shut down the server.",
    category: "server",
    requires: "OWNER",
    examples: ["quit"],
  },
  {
    name: "save",
    signature: "save",
    description: "Save the world to disk.",
    category: "server",
    requires: "ADMIN",
    examples: ["save"],
  },
  {
    name: "reloadlua",
    signature: 'reloadlua "file"',
    description: "Reload a specific Lua file without restart.",
    category: "server",
    requires: "OWNER",
    examples: ['reloadlua "media/lua/server/Events.lua"'],
  },
  {
    name: "reloadoptions",
    signature: "reloadoptions",
    description: "Reload server options (server.ini) without restart.",
    category: "server",
    requires: "OWNER",
    examples: ["reloadoptions"],
  },
  {
    name: "changeoption",
    signature: 'changeoption "name" "value"',
    description: "Change a server option value live.",
    category: "server",
    requires: "ADMIN",
    examples: ['changeoption "PVP" "true"', 'changeoption "PingLimit" "500"'],
  },
  {
    name: "showoptions",
    signature: "showoptions",
    description: "List all current server option values.",
    category: "server",
    requires: "ADMIN",
    examples: ["showoptions"],
  },
  {
    name: "releasesafehouse",
    signature: "releasesafehouse",
    description: "Release all currently claimed safehouses.",
    category: "server",
    requires: "ADMIN",
    examples: ["releasesafehouse"],
  },

  // --- PLAYER info + management ---
  {
    name: "players",
    signature: "players",
    description: "List connected players.",
    category: "player",
    requires: "MODERATOR",
    examples: ["players"],
  },
  {
    name: "playerinfo",
    signature: 'playerinfo "username"',
    description: "Show detailed info for one player.",
    category: "player",
    requires: "MODERATOR",
    examples: ['playerinfo "Honza"'],
  },
  {
    name: "connections",
    signature: "connections",
    description: "List all current connections with IPs.",
    category: "player",
    requires: "ADMIN",
    examples: ["connections"],
  },

  // --- MODERATION ---
  {
    name: "kickuser",
    signature: 'kickuser "username" [reason]',
    description: "Disconnect a player.",
    category: "moderation",
    requires: "MODERATOR",
    examples: ['kickuser "Drbna42" "afk 20min"'],
  },
  {
    name: "banuser",
    signature: 'banuser "username" -ip -r "reason"',
    description: "Permanent ban a player. -ip also bans by IP, -r sets reason.",
    category: "moderation",
    requires: "ADMIN",
    examples: ['banuser "Drbna42" -ip -r "griefing"'],
  },
  {
    name: "unbanuser",
    signature: 'unbanuser "username"',
    description: "Remove a username ban.",
    category: "moderation",
    requires: "ADMIN",
    examples: ['unbanuser "Drbna42"'],
  },
  {
    name: "banid",
    signature: 'banid "steamid"',
    description: "Ban a Steam ID from the server.",
    category: "moderation",
    requires: "ADMIN",
    examples: ['banid "76561198012345999"'],
  },
  {
    name: "unbanid",
    signature: 'unbanid "steamid"',
    description: "Remove a Steam ID ban.",
    category: "moderation",
    requires: "ADMIN",
    examples: ['unbanid "76561198012345999"'],
  },
  {
    name: "addsteamid",
    signature: 'addsteamid "steamid"',
    description: "Ban a Steam ID (alias for banid).",
    category: "moderation",
    requires: "ADMIN",
    examples: ['addsteamid "76561198012345999"'],
  },
  {
    name: "removesteamid",
    signature: 'removesteamid "steamid"',
    description: "Remove a Steam ID ban.",
    category: "moderation",
    requires: "ADMIN",
    examples: ['removesteamid "76561198012345999"'],
  },
  {
    name: "voiceban",
    signature: 'voiceban "username" -true|-false',
    description: "Ban or unban a player from voice chat.",
    category: "moderation",
    requires: "MODERATOR",
    examples: ['voiceban "LoudGuy" -true'],
  },

  // --- ADMIN LEVEL ---
  {
    name: "setaccesslevel",
    signature: 'setaccesslevel "username" "level"',
    description: "Set in-game admin level. Levels: none, observer, moderator, gm, overseer, admin.",
    category: "moderation",
    requires: "OWNER",
    examples: ['setaccesslevel "Honza" "admin"', 'setaccesslevel "Petr" "moderator"'],
  },
  {
    name: "grantadmin",
    signature: 'grantadmin "username"',
    description: "Grant full admin to a player (shortcut).",
    category: "moderation",
    requires: "OWNER",
    examples: ['grantadmin "Honza"'],
  },
  {
    name: "removeadmin",
    signature: 'removeadmin "username"',
    description: "Remove admin privileges.",
    category: "moderation",
    requires: "OWNER",
    examples: ['removeadmin "Petr"'],
  },

  // --- WHITELIST ---
  {
    name: "addusertowhitelist",
    signature: 'addusertowhitelist "username" "password"',
    description: "Add a whitelisted user with password. Required when Open=false.",
    category: "whitelist",
    requires: "ADMIN",
    examples: ['addusertowhitelist "Honza" "secretpw"'],
  },
  {
    name: "removeuserfromwhitelist",
    signature: 'removeuserfromwhitelist "username"',
    description: "Remove user from whitelist.",
    category: "whitelist",
    requires: "ADMIN",
    examples: ['removeuserfromwhitelist "Honza"'],
  },
  {
    name: "addalltowhitelist",
    signature: "addalltowhitelist",
    description:
      "Add ALL currently connected players to the whitelist with their current passwords.",
    category: "whitelist",
    requires: "ADMIN",
    examples: ["addalltowhitelist"],
  },

  // --- CHAT ---
  {
    name: "servermsg",
    signature: 'servermsg "message"',
    description: "Broadcast a message to all players.",
    category: "chat",
    requires: "MODERATOR",
    examples: ['servermsg "Server restart in 5 min"'],
  },
  {
    name: "whisper",
    signature: 'whisper "username" "message"',
    description: "Send a private message to one player.",
    category: "chat",
    requires: "MODERATOR",
    examples: ['whisper "Honza" "Jsi v porade?"'],
  },

  // --- WORLD events ---
  {
    name: "chopper",
    signature: "chopper",
    description: "Trigger a helicopter event at a random player.",
    category: "world",
    requires: "MODERATOR",
    examples: ["chopper"],
  },
  {
    name: "gunshot",
    signature: "gunshot",
    description: "Play a random gunshot sound in the world.",
    category: "world",
    requires: "MODERATOR",
    examples: ["gunshot"],
  },
  {
    name: "lightning",
    signature: 'lightning ["username"]',
    description: "Trigger lightning strike at a player (or random).",
    category: "world",
    requires: "ADMIN",
    examples: ["lightning", 'lightning "Honza"'],
  },
  {
    name: "thunder",
    signature: 'thunder ["username"]',
    description: "Trigger thunder at a player (or random).",
    category: "world",
    requires: "ADMIN",
    examples: ['thunder "Honza"'],
  },
  {
    name: "startrain",
    signature: "startrain",
    description: "Start rain.",
    category: "world",
    requires: "ADMIN",
    examples: ["startrain"],
  },
  {
    name: "stoprain",
    signature: "stoprain",
    description: "Stop rain.",
    category: "world",
    requires: "ADMIN",
    examples: ["stoprain"],
  },
  {
    name: "createhorde",
    signature: "createhorde <count>",
    description: "Spawn a zombie horde at random location.",
    category: "world",
    requires: "ADMIN",
    examples: ["createhorde 50"],
  },
  {
    name: "createhorde2",
    signature: 'createhorde2 <count> "username"',
    description: "Spawn a zombie horde at a player's location.",
    category: "world",
    requires: "ADMIN",
    examples: ['createhorde2 30 "Honza"'],
  },
  {
    name: "removezombies",
    signature: "removezombies",
    description: "Remove all zombies from the world.",
    category: "world",
    requires: "OWNER",
    examples: ["removezombies"],
  },

  // --- PLAYER items/xp/vehicles ---
  {
    name: "additem",
    signature: 'additem "username" "item" [count]',
    description: "Give item(s) to a player. Item = full Base.Xxx path.",
    category: "player",
    requires: "ADMIN",
    examples: ['additem "Honza" "Base.Axe" 1', 'additem "Petr" "Base.Nails" 50'],
  },
  {
    name: "addxp",
    signature: 'addxp "username" "perk=level"',
    description: "Grant XP in a perk to a player.",
    category: "player",
    requires: "ADMIN",
    examples: ['addxp "Honza" "Aiming=2"'],
  },
  {
    name: "addvehicle",
    signature: 'addvehicle "script" "username"',
    description: "Spawn a vehicle at a player. Script = Base.CarNormal, Base.Van, ...",
    category: "player",
    requires: "ADMIN",
    examples: ['addvehicle "Base.CarNormal" "Honza"'],
  },

  // --- DEBUG / cheats ---
  {
    name: "godmode",
    signature: 'godmode "username" -true|-false',
    description: "Toggle god mode for a player.",
    category: "debug",
    requires: "ADMIN",
    examples: ['godmode "Honza" -true'],
  },
  {
    name: "invisible",
    signature: 'invisible "username" -true|-false',
    description: "Toggle invisibility.",
    category: "debug",
    requires: "ADMIN",
    examples: ['invisible "Honza" -true'],
  },
  {
    name: "noclip",
    signature: 'noclip "username" -true|-false',
    description: "Toggle no-clip (fly through walls).",
    category: "debug",
    requires: "ADMIN",
    examples: ['noclip "Honza" -true'],
  },
  {
    name: "sethealth",
    signature: 'sethealth "username" <0-100>',
    description: "Set a player's health.",
    category: "debug",
    requires: "ADMIN",
    examples: ['sethealth "Honza" 100'],
  },
  {
    name: "teleport",
    signature: 'teleport "src" "dst"',
    description: "Teleport player src to player dst.",
    category: "debug",
    requires: "ADMIN",
    examples: ['teleport "Honza" "Petr"'],
  },
  {
    name: "teleportto",
    signature: "teleportto <x,y,z>",
    description: "Teleport yourself to world coordinates.",
    category: "debug",
    requires: "ADMIN",
    examples: ["teleportto 10000,8000,0"],
  },

  // --- REPLAY ---
  {
    name: "replay",
    signature: 'replay "username" -start|-stop|-play <file>',
    description: "Control player replay recording.",
    category: "replay",
    requires: "ADMIN",
    examples: ['replay "Honza" -start'],
  },
];

export function findCommand(name: string): RconCommandSpec | undefined {
  return RCON_COMMANDS.find((c) => c.name === name);
}

export const RCON_CATEGORIES: { key: RconCategory; label: string }[] = [
  { key: "server", label: "Server" },
  { key: "player", label: "Player" },
  { key: "moderation", label: "Moderation" },
  { key: "whitelist", label: "Whitelist" },
  { key: "chat", label: "Chat" },
  { key: "world", label: "World" },
  { key: "debug", label: "Debug" },
  { key: "replay", label: "Replay" },
];
