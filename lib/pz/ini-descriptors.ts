/**
 * Curated metadata for every documented PZ server.ini key we've seen in the
 * wild (B42 stable). Sourced from https://pzwiki.net/wiki/Server_settings and
 * cross-referenced against a live MajorlukPZ.ini dump. Any key not in
 * INI_DESCRIPTORS falls back to the generic "other" group via describeIni().
 *
 * The public surface (describeIni, INI_GROUP_LABELS, IniGroup) is stable —
 * new optional fields are added in-place.
 */

export type IniGroup =
  | "general"
  | "capacity"
  | "network"
  | "gameplay"
  | "pvp"
  | "safehouse"
  | "whitelist"
  | "anticheat"
  | "mods"
  | "voip"
  | "logging"
  | "discord"
  | "backup"
  | "chat"
  | "faction"
  | "other";

export type IniValueType = "bool" | "int" | "float" | "string" | "enum" | "csv";

export interface IniDescriptor {
  group: IniGroup;
  description: string;
  type: IniValueType;
  default?: boolean | number | string;
  min?: number;
  max?: number;
  step?: number;
  options?: Array<{ value: string | number; label: string; help?: string }>;
  /** Mark as containing credentials so the UI masks the value. */
  secret?: boolean;
  /** Whether changing this key requires a server restart. */
  requiresRestart?: boolean;
  /** Short anchor fragment for https://pzwiki.net/wiki/Server_settings#<hash>. */
  wikiHash?: string;
}

export const INI_DESCRIPTORS: Record<string, IniDescriptor> = {
  // =========================================================================
  // General
  // =========================================================================
  PublicName: {
    group: "general",
    description: "Server name shown in the public browser.",
    type: "string",
    default: "My PZ Server",
  },
  PublicDescription: {
    group: "general",
    description: "Long description shown in the public browser. Supports \\n for newlines.",
    type: "string",
    default: "",
  },
  Public: {
    group: "general",
    description: "List the server in the public browser. When false, server is invite-only.",
    type: "bool",
    default: false,
  },
  Open: {
    group: "general",
    description:
      "If false, server requires whitelist authentication — unknown Steam IDs are rejected.",
    type: "bool",
    default: true,
    requiresRestart: true,
  },
  ResetID: {
    group: "general",
    description:
      "Numeric world reset ID. Changing forces connected clients to wipe local map data on next join.",
    type: "int",
    default: 572058526,
    requiresRestart: true,
  },
  ServerPlayerID: {
    group: "general",
    description: "Unique server identifier. Auto-generated; do not edit manually.",
    type: "int",
  },
  ServerWelcomeMessage: {
    group: "general",
    description: "Message shown in chat when a player connects.",
    type: "string",
  },
  Seed: {
    group: "general",
    description: "World seed used for procedural generation. Blank = random.",
    type: "string",
    requiresRestart: true,
  },
  SaveWorldEveryMinutes: {
    group: "general",
    description: "Automatic save interval in minutes. 0 disables.",
    type: "int",
    default: 0,
    min: 0,
  },
  Password: {
    group: "general",
    description: "In-game join password. Empty means no password required.",
    type: "string",
    secret: true,
    default: "",
  },
  server_browser_announced_ip: {
    group: "general",
    description: "Override the IP shown in the public browser. Leave blank for auto-detection.",
    type: "string",
  },

  // =========================================================================
  // Capacity
  // =========================================================================
  MaxPlayers: {
    group: "capacity",
    description: "Maximum concurrent players.",
    type: "int",
    default: 32,
    min: 1,
    max: 100,
    requiresRestart: true,
  },
  MaxAccountsPerUser: {
    group: "capacity",
    description: "Max characters per Steam account on this server. 0 = unlimited.",
    type: "int",
    default: 0,
    min: 0,
  },
  LoginQueueEnabled: {
    group: "capacity",
    description: "Hold overflow joins in a queue when MaxPlayers is reached.",
    type: "bool",
    default: false,
  },
  LoginQueueConnectTimeout: {
    group: "capacity",
    description: "Seconds before a queued client times out waiting for a slot.",
    type: "int",
    default: 60,
    min: 5,
  },
  DenyLoginOnOverloadedServer: {
    group: "capacity",
    description: "Reject new logins when the server tick is falling behind.",
    type: "bool",
    default: true,
  },
  ItemNumbersLimitPerContainer: {
    group: "capacity",
    description: "Cap on items per container. 0 disables. Prevents lag from hoarders.",
    type: "int",
    default: 0,
    min: 0,
  },

  // =========================================================================
  // Network
  // =========================================================================
  DefaultPort: {
    group: "network",
    description: "Game UDP port.",
    type: "int",
    default: 16261,
    min: 1,
    max: 65535,
    requiresRestart: true,
  },
  UDPPort: {
    group: "network",
    description: "Steam UDP query port.",
    type: "int",
    default: 8766,
    min: 1,
    max: 65535,
    requiresRestart: true,
  },
  RCONPort: {
    group: "network",
    description: "RCON listener port.",
    type: "int",
    default: 27015,
    min: 1,
    max: 65535,
    requiresRestart: true,
  },
  RCONPassword: {
    group: "network",
    description: "RCON authentication password.",
    type: "string",
    secret: true,
  },
  PingLimit: {
    group: "network",
    description: "Auto-kick players above this ping (ms). 0 disables.",
    type: "int",
    default: 400,
    min: 0,
  },
  UPnP: {
    group: "network",
    description: "Try to forward game ports via UPnP at startup.",
    type: "bool",
    default: true,
    requiresRestart: true,
  },
  MaxPacketsPerSecond: {
    group: "network",
    description: "Per-client packet rate limit for anti-DOS.",
    type: "int",
    default: 120,
    min: 30,
  },
  SteamVAC: {
    group: "network",
    description: "Enable Valve Anti-Cheat for this server.",
    type: "bool",
    default: true,
    requiresRestart: true,
  },
  SteamScoreboard: {
    group: "network",
    description:
      'Control whether Steam identifiers are shown in scoreboards. "true"/"false"/"admin".',
    type: "enum",
    default: "true",
    options: [
      { value: "true", label: "Visible to all" },
      { value: "false", label: "Hidden" },
      { value: "admin", label: "Admin only" },
    ],
  },
  MultiplayerStatisticsPeriod: {
    group: "network",
    description: "Seconds between server → Steam heartbeats. 0 disables.",
    type: "int",
    default: 0,
    min: 0,
  },

  // =========================================================================
  // Gameplay
  // =========================================================================
  PVP: {
    group: "gameplay",
    description: "Enable player-vs-player damage globally.",
    type: "bool",
    default: true,
  },
  PauseEmpty: {
    group: "gameplay",
    description: "Pause in-game time when no players are connected.",
    type: "bool",
    default: true,
  },
  GlobalChat: {
    group: "gameplay",
    description: "Enable the /all global chat channel.",
    type: "bool",
    default: true,
  },
  AllowCoop: {
    group: "gameplay",
    description: "Allow Steam Friends → Play Coop joins to this server.",
    type: "bool",
    default: true,
  },
  SpawnItems: {
    group: "gameplay",
    description: "Comma-separated items granted to new survivors. e.g. Base.Axe,Base.Bandage.",
    type: "csv",
    default: "",
  },
  SpawnPoint: {
    group: "gameplay",
    description: "Override spawn point as x,y,z. 0,0,0 = spawn region default.",
    type: "string",
    default: "0,0,0",
  },
  KnockedDownAllowed: {
    group: "gameplay",
    description: "Allow the knocked-down animation/state.",
    type: "bool",
    default: true,
  },
  SneakModeHideFromOtherPlayers: {
    group: "gameplay",
    description: "Sneaking also hides you from other players, not just zombies.",
    type: "bool",
    default: true,
  },
  SpeedLimit: {
    group: "gameplay",
    description: "Cap vehicle top speed in km/h. 0 = uncapped.",
    type: "float",
    default: 70.0,
    min: 0.0,
  },
  PlayerBumpPlayer: {
    group: "gameplay",
    description: "Allow players to push/bump each other.",
    type: "bool",
    default: false,
  },
  MapRemotePlayerVisibility: {
    group: "gameplay",
    description:
      "Map visibility of other players: 1=off, 2=friends/faction only, 3=all players.",
    type: "enum",
    default: 1,
    options: [
      { value: 1, label: "Hidden from map" },
      { value: 2, label: "Friends & factions" },
      { value: 3, label: "All players" },
    ],
  },
  SleepAllowed: {
    group: "gameplay",
    description: "Allow the sleep action (enables Sleep Needed on hosts).",
    type: "bool",
    default: false,
  },
  SleepNeeded: {
    group: "gameplay",
    description: "Players must sleep to restore fatigue — requires SleepAllowed.",
    type: "bool",
    default: false,
  },
  TrashDeleteAll: {
    group: "gameplay",
    description: "Delete ALL trash in containers in bulk admin ops (destructive).",
    type: "bool",
    default: false,
  },
  AnnounceDeath: {
    group: "gameplay",
    description: "Announce player deaths in global chat.",
    type: "bool",
    default: false,
  },
  AnnounceAnimalDeath: {
    group: "gameplay",
    description: "Announce animal deaths in global chat.",
    type: "bool",
    default: false,
  },
  RemovePlayerCorpsesOnCorpseRemoval: {
    group: "gameplay",
    description: "Also sweep player corpses when the world cleans up zombie corpses.",
    type: "bool",
    default: false,
  },
  SwitchZombiesOwnershipEachUpdate: {
    group: "gameplay",
    description:
      "Re-assign zombie authority each tick. Fixes sync issues at the cost of CPU.",
    type: "bool",
    default: false,
  },
  FastForwardMultiplier: {
    group: "gameplay",
    description: "Solo-style time acceleration multiplier when all players sleep.",
    type: "float",
    default: 40.0,
    min: 1.0,
  },
  SafetySystem: {
    group: "gameplay",
    description: "Enables the consensual-PVP safety toggle for non-combatants.",
    type: "bool",
    default: true,
  },
  ShowSafety: {
    group: "gameplay",
    description: "Show safety status icon above players.",
    type: "bool",
    default: true,
  },
  SafetyToggleTimer: {
    group: "gameplay",
    description: "Cooldown (seconds) between safety on/off toggles.",
    type: "int",
    default: 2,
    min: 0,
  },
  SafetyCooldownTimer: {
    group: "gameplay",
    description: "Cooldown (seconds) before damage applies after a safety toggle.",
    type: "int",
    default: 3,
    min: 0,
  },
  SafetyDisconnectDelay: {
    group: "gameplay",
    description: "Seconds the body lingers after disconnect before becoming safe.",
    type: "int",
    default: 30,
    min: 0,
  },
  AllowDestructionBySledgehammer: {
    group: "gameplay",
    description: "Sledgehammer can destroy any tile, including player constructions.",
    type: "bool",
    default: true,
  },
  SledgehammerOnlyInSafehouse: {
    group: "gameplay",
    description: "Restrict destruction to safehouses you own.",
    type: "bool",
    default: false,
  },
  NoFire: {
    group: "gameplay",
    description: "Disable fire/ignition server-wide.",
    type: "bool",
    default: false,
  },
  BloodSplatLifespanDays: {
    group: "gameplay",
    description: "Days before blood splats fade from the world. 0 disables fade.",
    type: "int",
    default: 0,
    min: 0,
  },
  UltraSpeedDoesnotAffectToAnimals: {
    group: "gameplay",
    description: "Animals tick at normal speed even during admin ultra-speed.",
    type: "bool",
    default: false,
  },
  CarEngineAttractionModifier: {
    group: "gameplay",
    description: "Multiplier for how loud vehicle engines are to zombies.",
    type: "float",
    default: 0.5,
    min: 0.0,
  },
  DisableTrailerTowing: {
    group: "gameplay",
    description: "Disable trailer attach/tow mechanics.",
    type: "bool",
    default: false,
  },
  DisableVehicleTowing: {
    group: "gameplay",
    description: "Disable all vehicle-to-vehicle towing.",
    type: "bool",
    default: false,
  },
  DisableBurntTowing: {
    group: "gameplay",
    description: "Disable towing of burnt vehicles.",
    type: "bool",
    default: false,
  },
  ShowFirstAndLastName: {
    group: "gameplay",
    description: "Show the player's in-world name above the head.",
    type: "bool",
    default: true,
  },
  DisplayUserName: {
    group: "gameplay",
    description: "Show the Steam account name above the head.",
    type: "bool",
    default: true,
  },
  HideDisguisedUserName: {
    group: "gameplay",
    description: "When disguises are on, hide the underlying username.",
    type: "bool",
    default: true,
  },
  UsernameDisguises: {
    group: "gameplay",
    description: "Enable username-disguise mechanic for roleplay servers.",
    type: "bool",
    default: false,
  },
  MouseOverToSeeDisplayName: {
    group: "gameplay",
    description: "Require mouse-over to reveal player name tags.",
    type: "bool",
    default: true,
  },
  HidePlayersBehindYou: {
    group: "gameplay",
    description: "Cull player rendering when they're directly behind your character.",
    type: "bool",
    default: true,
  },
  AllowNonAsciiUsername: {
    group: "gameplay",
    description: "Allow non-ASCII characters in display names.",
    type: "bool",
    default: false,
  },
  UsePhysicsHitReaction: {
    group: "gameplay",
    description: "Enable the physics-driven hit reaction system for combat feedback.",
    type: "bool",
    default: false,
  },
  DisableScoreboard: {
    group: "gameplay",
    description: "Disable the in-game scoreboard (Tab key).",
    type: "bool",
    default: false,
  },

  // =========================================================================
  // PVP
  // =========================================================================
  PVPFirearmDamageModifier: {
    group: "pvp",
    description: "Multiplier applied to PVP firearm damage only.",
    type: "float",
    default: 50.0,
    min: 0.0,
  },
  PVPMeleeDamageModifier: {
    group: "pvp",
    description: "Multiplier applied to PVP melee damage only.",
    type: "float",
    default: 30.0,
    min: 0.0,
  },
  PVPMeleeWhileHitReaction: {
    group: "pvp",
    description: "Allow chain-hitting in melee through the hit-reaction animation.",
    type: "bool",
    default: false,
  },
  PVPLogToolChat: {
    group: "pvp",
    description: "Also log PVP hits to the in-game chat for admins.",
    type: "bool",
    default: false,
  },
  PVPLogToolFile: {
    group: "pvp",
    description: "Log PVP hits to disk for after-action review.",
    type: "bool",
    default: true,
  },
  War: {
    group: "pvp",
    description: "Enable the War system (claimable factional territory).",
    type: "bool",
    default: false,
  },
  WarDuration: {
    group: "pvp",
    description: "Duration of a War event in minutes.",
    type: "int",
    default: 60,
    min: 1,
  },
  WarStartDelay: {
    group: "pvp",
    description: "Delay before a declared War starts, in minutes.",
    type: "int",
    default: 5,
    min: 0,
  },
  WarSafehouseHitPoints: {
    group: "pvp",
    description: "HP granted to safehouse walls during an active War.",
    type: "int",
    default: 2000,
    min: 0,
  },

  // =========================================================================
  // Safehouse
  // =========================================================================
  PlayerSafehouse: {
    group: "safehouse",
    description: "Allow players to claim safehouses.",
    type: "bool",
    default: true,
  },
  AdminSafehouse: {
    group: "safehouse",
    description: "Allow admin accounts to claim safehouses.",
    type: "bool",
    default: false,
  },
  SafehouseAllowTrepass: {
    group: "safehouse",
    description: "Non-members can enter your safehouse without breaking it.",
    type: "bool",
    default: true,
  },
  SafehouseAllowFire: {
    group: "safehouse",
    description: "Allow fire to damage safehouse tiles.",
    type: "bool",
    default: true,
  },
  SafehouseAllowLoot: {
    group: "safehouse",
    description: "Non-members can take items from safehouses.",
    type: "bool",
    default: true,
  },
  SafehouseAllowRespawn: {
    group: "safehouse",
    description: "Members can respawn at their safehouse.",
    type: "bool",
    default: false,
  },
  SafehouseAllowNonResidential: {
    group: "safehouse",
    description: "Allow claiming non-residential buildings (stores, industrial).",
    type: "bool",
    default: false,
  },
  SafehouseDaySurvivedToClaim: {
    group: "safehouse",
    description: "In-game days a player must survive before claiming their first safehouse.",
    type: "int",
    default: 0,
    min: 0,
  },
  SafehouseDisableDisguises: {
    group: "safehouse",
    description: "Disable disguise mechanic within safehouses.",
    type: "bool",
    default: false,
  },
  SafehousePreventsLootRespawn: {
    group: "safehouse",
    description: "Claimed safehouses never re-spawn loot in their containers.",
    type: "bool",
    default: true,
  },
  MaxSafezoneSize: {
    group: "safehouse",
    description: "Maximum footprint in tiles a single safehouse can cover.",
    type: "int",
    default: 40,
    min: 1,
  },
  SafeHouseRemovalTime: {
    group: "safehouse",
    description: "In-game hours a safehouse can go without member logins before being released.",
    type: "int",
    default: 144,
    min: 0,
  },
  DisableSafehouseWhenPlayerConnected: {
    group: "safehouse",
    description: "Temporarily disable safehouse protection while a member is online.",
    type: "bool",
    default: false,
  },
  PlayerRespawnWithSelf: {
    group: "safehouse",
    description: "Allow respawning at your own death location.",
    type: "bool",
    default: false,
  },
  PlayerRespawnWithOther: {
    group: "safehouse",
    description: "Allow respawning at a teammate's location.",
    type: "bool",
    default: false,
  },

  // =========================================================================
  // Whitelist
  // =========================================================================
  AutoCreateUserInWhiteList: {
    group: "whitelist",
    description: "Auto-create a whitelist row when an unknown player connects.",
    type: "bool",
    default: false,
  },
  DropOffWhiteListAfterDeath: {
    group: "whitelist",
    description: "Drop a player from the whitelist after death.",
    type: "bool",
    default: false,
  },
  DoLuaChecksum: {
    group: "whitelist",
    description: "Validate client Lua against the server to prevent tampering.",
    type: "bool",
    default: true,
    requiresRestart: true,
  },
  HideAdminsInPlayerList: {
    group: "whitelist",
    description: "Omit admin accounts from /players output for non-admins.",
    type: "bool",
    default: false,
  },
  BanKickGlobalSound: {
    group: "whitelist",
    description: "Play the server-wide ban/kick sound effect.",
    type: "bool",
    default: true,
  },

  // =========================================================================
  // Anti-cheat
  // =========================================================================
  AntiCheatChecksum: {
    group: "anticheat",
    description: "Verify game file checksums at connect time.",
    type: "bool",
    default: true,
  },
  AntiCheatFire: {
    group: "anticheat",
    description: "Kick players who attempt impossible fire spread.",
    type: "bool",
    default: true,
  },
  AntiCheatHit: {
    group: "anticheat",
    description: "Kick players who register damage from impossible positions.",
    type: "bool",
    default: true,
  },
  AntiCheatItem: {
    group: "anticheat",
    description: "Kick players who spawn items they shouldn't have.",
    type: "bool",
    default: true,
  },
  AntiCheatMovement: {
    group: "anticheat",
    description: "Kick players who move faster than physically possible.",
    type: "bool",
    default: true,
  },
  AntiCheatPacket: {
    group: "anticheat",
    description: "Drop malformed or impossible packets.",
    type: "bool",
    default: true,
  },
  AntiCheatPermission: {
    group: "anticheat",
    description: "Enforce admin-only actions server-side.",
    type: "bool",
    default: true,
  },
  AntiCheatPlayer: {
    group: "anticheat",
    description: "Validate per-player state (stats, perks) on sync.",
    type: "bool",
    default: true,
  },
  AntiCheatRecipe: {
    group: "anticheat",
    description: "Kick for crafting recipes the player hasn't learned.",
    type: "bool",
    default: true,
  },
  AntiCheatSafeHouse: {
    group: "anticheat",
    description: "Enforce safehouse membership for actions.",
    type: "bool",
    default: true,
  },
  AntiCheatSafety: {
    group: "anticheat",
    description: "Enforce the PVP safety toggle cooldown.",
    type: "bool",
    default: true,
  },
  AntiCheatServerCustomization: {
    group: "anticheat",
    description: "Reject client-side mods of server-controlled rules.",
    type: "bool",
    default: true,
  },
  AntiCheatXP: {
    group: "anticheat",
    description: "Validate XP gains against expected values.",
    type: "bool",
    default: true,
  },
  ClientActionLogs: {
    group: "anticheat",
    description: "Log client-side actions (crafting, safehouse claims) to disk.",
    type: "string",
    default: "ISCraftingUI;ISWorldObjectContextMenu;",
  },
  ClientCommandFilter: {
    group: "anticheat",
    description: "Semicolon-separated list of client RPCs to block.",
    type: "string",
    default: "",
  },

  // =========================================================================
  // Radio (staff invisibility / channels)
  // =========================================================================
  DisableRadioStaff: {
    group: "gameplay",
    description: "Strip staff (admin/GM/moderator/overseer) from broadcasting on player radios.",
    type: "bool",
    default: false,
  },
  DisableRadioAdmin: {
    group: "gameplay",
    description: "Prevent the Admin access role from transmitting via radio.",
    type: "bool",
    default: true,
  },
  DisableRadioGM: {
    group: "gameplay",
    description: "Prevent the GM role from transmitting via radio.",
    type: "bool",
    default: true,
  },
  DisableRadioOverseer: {
    group: "gameplay",
    description: "Prevent the Overseer role from transmitting via radio.",
    type: "bool",
    default: false,
  },
  DisableRadioModerator: {
    group: "gameplay",
    description: "Prevent the Moderator role from transmitting via radio.",
    type: "bool",
    default: false,
  },
  DisableRadioInvisible: {
    group: "gameplay",
    description: "Prevent invisible-admin users from transmitting via radio.",
    type: "bool",
    default: true,
  },

  // =========================================================================
  // Mods & Map
  // =========================================================================
  Mods: {
    group: "mods",
    description: "Mod IDs in load order (semicolon-separated).",
    type: "csv",
    default: "",
    requiresRestart: true,
  },
  WorkshopItems: {
    group: "mods",
    description: "Steam Workshop item IDs to download (semicolon-separated).",
    type: "csv",
    default: "",
    requiresRestart: true,
  },
  Map: {
    group: "mods",
    description: "Map identifier. Default is Muldraugh, KY. Custom maps list semicolon-separated.",
    type: "string",
    default: "Muldraugh, KY",
    requiresRestart: true,
  },

  // =========================================================================
  // Voice (VOIP)
  // =========================================================================
  VoiceEnable: {
    group: "voip",
    description: "Enable in-game voice chat.",
    type: "bool",
    default: true,
  },
  VoiceMinDistance: {
    group: "voip",
    description: "Voice attenuation start (tiles).",
    type: "float",
    default: 10.0,
    min: 0.0,
  },
  VoiceMaxDistance: {
    group: "voip",
    description: "Voice attenuation end (tiles).",
    type: "float",
    default: 100.0,
    min: 0.0,
  },

  // =========================================================================
  // Logging
  // =========================================================================
  LogLocalChat: {
    group: "logging",
    description: "Log local-radius chat messages to disk.",
    type: "bool",
    default: false,
  },
  PerkLogs: {
    group: "logging",
    description: "Log perk level changes.",
    type: "bool",
    default: true,
  },

  // =========================================================================
  // Discord
  // =========================================================================
  DiscordEnable: {
    group: "discord",
    description: "Mirror chat to a Discord channel via the built-in bridge.",
    type: "bool",
    default: false,
  },
  DiscordToken: {
    group: "discord",
    description: "Bot token for the Discord bridge.",
    type: "string",
    secret: true,
  },
  DiscordChannel: {
    group: "discord",
    description: "Legacy: name or ID of the Discord channel (deprecated — use DiscordChatChannel).",
    type: "string",
  },
  DiscordChannelID: {
    group: "discord",
    description: "Legacy: Discord channel snowflake ID.",
    type: "string",
  },
  DiscordChatChannel: {
    group: "discord",
    description: "Channel for in-game → Discord chat mirroring.",
    type: "string",
  },
  DiscordCommandChannel: {
    group: "discord",
    description: "Channel authorized for Discord → server admin commands.",
    type: "string",
  },
  DiscordLogChannel: {
    group: "discord",
    description: "Channel for server log mirroring (joins, deaths, errors).",
    type: "string",
  },

  // =========================================================================
  // Backups
  // =========================================================================
  BackupsCount: {
    group: "backup",
    description: "Number of rotating backups to keep.",
    type: "int",
    default: 5,
    min: 1,
  },
  BackupsOnStart: {
    group: "backup",
    description: "Take a backup at server startup.",
    type: "bool",
    default: true,
  },
  BackupsOnVersionChange: {
    group: "backup",
    description: "Take a backup when the PZ version changes.",
    type: "bool",
    default: true,
  },
  BackupsPeriod: {
    group: "backup",
    description: "Automatic backup interval in minutes. 0 disables.",
    type: "int",
    default: 0,
    min: 0,
  },

  // =========================================================================
  // Chat
  // =========================================================================
  ChatStreams: {
    group: "chat",
    description: "Comma-separated list of enabled chat streams (s,r,a,w,y,sh,f,all,rp).",
    type: "csv",
    default: "s,r,a,w,y,sh,f,all",
  },
  ChatMessageCharacterLimit: {
    group: "chat",
    description: "Max characters per chat message.",
    type: "int",
    default: 250,
    min: 1,
  },
  ChatMessageSlowModeTime: {
    group: "chat",
    description: "Cooldown (seconds) between messages per player. 0 disables.",
    type: "int",
    default: 0,
    min: 0,
  },
  BadWordListFile: {
    group: "chat",
    description: "Path (relative to server dir) to the disallowed-word list.",
    type: "string",
  },
  BadWordPolicy: {
    group: "chat",
    description: 'What to do on a match: "Replace", "Kick", or "Block".',
    type: "enum",
    default: "Replace",
    options: [
      { value: "Replace", label: "Replace with replacement" },
      { value: "Kick", label: "Kick speaker" },
      { value: "Block", label: "Drop message silently" },
    ],
  },
  BadWordReplacement: {
    group: "chat",
    description: "Character(s) used to replace bad words when policy is Replace.",
    type: "string",
    default: "*",
  },
  GoodWordListFile: {
    group: "chat",
    description: "Path to an allow-list overriding the bad-word filter.",
    type: "string",
  },
  WebhookAddress: {
    group: "chat",
    description: "Outbound webhook URL for chat mirroring.",
    type: "string",
  },

  // =========================================================================
  // Factions
  // =========================================================================
  Faction: {
    group: "faction",
    description: "Enable the faction / player group system.",
    type: "bool",
    default: true,
  },
  FactionDaySurvivedToCreate: {
    group: "faction",
    description: "In-game days a player must survive before founding a faction.",
    type: "int",
    default: 0,
    min: 0,
  },
  FactionPlayersRequiredForTag: {
    group: "faction",
    description: "Minimum member count before a faction can display its tag.",
    type: "int",
    default: 1,
    min: 1,
  },
};

export function describeIni(key: string): IniDescriptor {
  return (
    INI_DESCRIPTORS[key] ?? {
      group: "other",
      description: "(no description — see pzwiki.net/wiki/Server_settings)",
      type: "string",
    }
  );
}

export const INI_GROUP_LABELS: Record<IniGroup, string> = {
  general: "General",
  capacity: "Capacity",
  network: "Network",
  gameplay: "Gameplay",
  pvp: "PVP",
  safehouse: "Safehouses",
  whitelist: "Whitelist",
  anticheat: "Anti-cheat",
  mods: "Mods & Map",
  voip: "Voice (VOIP)",
  logging: "Logging",
  discord: "Discord",
  backup: "Backups",
  chat: "Chat",
  faction: "Factions",
  other: "Other",
};
