/**
 * Hardcoded hints for the most common PZ server.ini keys. Sourced from
 * https://pzwiki.net/wiki/Server_settings — we just paraphrase the highlights
 * so the admin doesn't have to context-switch to the wiki for the basics.
 */

export type IniGroup =
  | "general"
  | "capacity"
  | "network"
  | "gameplay"
  | "whitelist"
  | "mods"
  | "voip"
  | "logging"
  | "other";

export interface IniDescriptor {
  group: IniGroup;
  description: string;
  /** Whether changing this key requires a server restart. */
  requiresRestart?: boolean;
}

export const INI_DESCRIPTORS: Record<string, IniDescriptor> = {
  // General
  PublicName: {
    group: "general",
    description: "Server name shown in the public browser.",
  },
  PublicDescription: {
    group: "general",
    description: "Long description shown in the public browser.",
  },
  Public: {
    group: "general",
    description: "List the server in the public browser.",
  },
  ResetID: {
    group: "general",
    description: "Numeric world reset ID.",
    requiresRestart: true,
  },
  ServerWelcomeMessage: {
    group: "general",
    description: "Message shown in chat when a player connects.",
  },

  // Capacity
  MaxPlayers: {
    group: "capacity",
    description: "Maximum concurrent players.",
    requiresRestart: true,
  },
  MaxAccountsPerUser: {
    group: "capacity",
    description: "Max characters per Steam account.",
  },

  // Network
  DefaultPort: {
    group: "network",
    description: "Game UDP port (default 16261).",
    requiresRestart: true,
  },
  UDPPort: {
    group: "network",
    description: "Steam UDP port (default 8766).",
    requiresRestart: true,
  },
  RCONPort: {
    group: "network",
    description: "RCON listener port.",
    requiresRestart: true,
  },
  RCONPassword: {
    group: "network",
    description: "RCON authentication password (sensitive).",
  },
  PingLimit: {
    group: "network",
    description: "Auto-kick players above this ping (ms). 0 disables.",
  },

  // Gameplay
  PVP: { group: "gameplay", description: "Enable player-vs-player damage." },
  PauseEmpty: {
    group: "gameplay",
    description: "Pause time when no players are connected.",
  },
  Open: {
    group: "gameplay",
    description: "If false, server requires whitelist authentication.",
    requiresRestart: true,
  },
  SafetySystem: {
    group: "gameplay",
    description: "Enables the consensual-PVP safety toggle.",
  },
  ShowSafety: {
    group: "gameplay",
    description: "Show safety status above players.",
  },
  SafetyToggleTimer: {
    group: "gameplay",
    description: "Cooldown (seconds) for changing safety state.",
  },
  SafetyCooldownTimer: {
    group: "gameplay",
    description: "Cooldown (seconds) before damage applies after safety toggle.",
  },
  SpawnItems: {
    group: "gameplay",
    description: "Comma-separated items granted to new survivors.",
  },
  SpawnPoint: {
    group: "gameplay",
    description: "Override spawn point as x,y,z. 0,0,0 = default.",
  },

  // Whitelist
  AutoCreateUserInWhiteList: {
    group: "whitelist",
    description: "Auto-create whitelist row when an unknown player connects.",
  },
  DropOffWhiteListAfterDeath: {
    group: "whitelist",
    description: "Drop a player from the whitelist after death.",
  },

  // Mods
  Mods: {
    group: "mods",
    description: "Mod IDs (comma-separated load order).",
    requiresRestart: true,
  },
  WorkshopItems: {
    group: "mods",
    description: "Workshop item IDs to download (comma-separated).",
    requiresRestart: true,
  },
  Map: {
    group: "mods",
    description: "Custom map identifier (Muldraugh, KY by default).",
    requiresRestart: true,
  },

  // Voip
  VoiceEnable: { group: "voip", description: "Enable in-game voice chat." },
  VoiceMinDistance: {
    group: "voip",
    description: "Voice attenuation start (tiles).",
  },
  VoiceMaxDistance: {
    group: "voip",
    description: "Voice attenuation end (tiles).",
  },

  // Logging
  LogLocalChat: {
    group: "logging",
    description: "Log local-radius chat messages.",
  },
  PerkLogs: {
    group: "logging",
    description: "Log perk level changes.",
  },
};

export function describeIni(key: string): IniDescriptor {
  return (
    INI_DESCRIPTORS[key] ?? {
      group: "other",
      description: "(no description — see pzwiki.net/wiki/Server_settings)",
    }
  );
}

export const INI_GROUP_LABELS: Record<IniGroup, string> = {
  general: "General",
  capacity: "Capacity",
  network: "Network",
  gameplay: "Gameplay",
  whitelist: "Whitelist",
  mods: "Mods & Map",
  voip: "Voice (VOIP)",
  logging: "Logging",
  other: "Other",
};
