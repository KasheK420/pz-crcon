import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parseSandboxLua } from "@/lib/pz/parse-sandbox-lua";
import {
  describeSandbox,
  SANDBOX_DESCRIPTORS,
} from "@/lib/pz/sandbox-descriptors";
import { describeIni, INI_DESCRIPTORS } from "@/lib/pz/ini-descriptors";

const FIXTURE = resolve(__dirname, "../../fixtures/servertest-sandbox.lua");
const LIVE_FIXTURE = resolve(__dirname, "../../fixtures/live-sandbox.lua");

describe("sandbox descriptor coverage", () => {
  it("every key in the stock B42 fixture has a descriptor", () => {
    const stock = readFileSync(FIXTURE, "utf8");
    const parsed = parseSandboxLua(stock);
    const missing: string[] = [];
    for (const section of parsed.sections) {
      for (const entry of section.entries) {
        const path =
          section.name === "_root" ? entry.key : `${section.name}.${entry.key}`;
        if (!describeSandbox(path)) missing.push(path);
      }
    }
    expect(missing).toEqual([]);
  });

  it("every key in the live (production) snapshot has a descriptor", () => {
    // Live snapshot differs from stock only in values. Both should have 100%
    // descriptor coverage; this guards against future drift from sandbox keys
    // added by mods landing in live without being absorbed into stock.
    const live = readFileSync(LIVE_FIXTURE, "utf8");
    const parsed = parseSandboxLua(live);
    const missing: string[] = [];
    for (const section of parsed.sections) {
      for (const entry of section.entries) {
        const path =
          section.name === "_root" ? entry.key : `${section.name}.${entry.key}`;
        if (!describeSandbox(path)) missing.push(path);
      }
    }
    expect(missing).toEqual([]);
  });

  it("descriptor type matches parsed value type for the stock fixture", () => {
    const stock = readFileSync(FIXTURE, "utf8");
    const parsed = parseSandboxLua(stock);
    const mismatched: string[] = [];
    for (const section of parsed.sections) {
      for (const entry of section.entries) {
        const path =
          section.name === "_root" ? entry.key : `${section.name}.${entry.key}`;
        const d = describeSandbox(path);
        if (!d) continue;
        const pt = typeof entry.value;
        const ok =
          (d.type === "bool" && pt === "boolean") ||
          (d.type === "int" && pt === "number") ||
          (d.type === "float" && pt === "number") ||
          (d.type === "enum" && (pt === "number" || pt === "string")) ||
          (d.type === "string" && pt === "string");
        if (!ok) mismatched.push(`${path}: desc=${d.type} parsed=${pt}`);
      }
    }
    expect(mismatched).toEqual([]);
  });

  it("every descriptor is reachable via describeSandbox()", () => {
    for (const d of SANDBOX_DESCRIPTORS) {
      expect(describeSandbox(d.path)).toBe(d);
    }
  });

  it("descriptor paths are unique", () => {
    const paths = SANDBOX_DESCRIPTORS.map((d) => d.path);
    const set = new Set(paths);
    expect(set.size).toBe(paths.length);
  });
});

describe("ini descriptor coverage", () => {
  // Snapshot of the key set observed in the live MajorlukPZ.ini (B42 stable).
  // Keep in sync with:
  //   ssh homepl "grep -E '^[A-Za-z_]+=' /var/lib/docker/volumes/pz-data/_data/Server/MajorlukPZ.ini | cut -d= -f1 | sort -u"
  const LIVE_INI_KEYS = [
    "AdminSafehouse",
    "AllowCoop",
    "AllowDestructionBySledgehammer",
    "AllowNonAsciiUsername",
    "AnnounceAnimalDeath",
    "AnnounceDeath",
    "AntiCheatChecksum",
    "AntiCheatFire",
    "AntiCheatHit",
    "AntiCheatItem",
    "AntiCheatMovement",
    "AntiCheatPacket",
    "AntiCheatPermission",
    "AntiCheatPlayer",
    "AntiCheatRecipe",
    "AntiCheatSafeHouse",
    "AntiCheatSafety",
    "AntiCheatServerCustomization",
    "AntiCheatXP",
    "AutoCreateUserInWhiteList",
    "BackupsCount",
    "BackupsOnStart",
    "BackupsOnVersionChange",
    "BackupsPeriod",
    "BadWordListFile",
    "BadWordPolicy",
    "BadWordReplacement",
    "BanKickGlobalSound",
    "BloodSplatLifespanDays",
    "CarEngineAttractionModifier",
    "ChatMessageCharacterLimit",
    "ChatMessageSlowModeTime",
    "ChatStreams",
    "ClientActionLogs",
    "ClientCommandFilter",
    "DefaultPort",
    "DenyLoginOnOverloadedServer",
    "DisableBurntTowing",
    "DisableRadioAdmin",
    "DisableRadioGM",
    "DisableRadioInvisible",
    "DisableRadioModerator",
    "DisableRadioOverseer",
    "DisableRadioStaff",
    "DisableSafehouseWhenPlayerConnected",
    "DisableScoreboard",
    "DisableTrailerTowing",
    "DisableVehicleTowing",
    "DiscordChatChannel",
    "DiscordCommandChannel",
    "DiscordEnable",
    "DiscordLogChannel",
    "DiscordToken",
    "DisplayUserName",
    "DoLuaChecksum",
    "DropOffWhiteListAfterDeath",
    "Faction",
    "FactionDaySurvivedToCreate",
    "FactionPlayersRequiredForTag",
    "FastForwardMultiplier",
    "GlobalChat",
    "GoodWordListFile",
    "HideAdminsInPlayerList",
    "HideDisguisedUserName",
    "HidePlayersBehindYou",
    "ItemNumbersLimitPerContainer",
    "KnockedDownAllowed",
    "LoginQueueConnectTimeout",
    "LoginQueueEnabled",
    "Map",
    "MapRemotePlayerVisibility",
    "MaxAccountsPerUser",
    "MaxPacketsPerSecond",
    "MaxPlayers",
    "MaxSafezoneSize",
    "Mods",
    "MouseOverToSeeDisplayName",
    "MultiplayerStatisticsPeriod",
    "NoFire",
    "Open",
    "PVP",
    "PVPFirearmDamageModifier",
    "PVPLogToolChat",
    "PVPLogToolFile",
    "PVPMeleeDamageModifier",
    "PVPMeleeWhileHitReaction",
    "Password",
    "PauseEmpty",
    "PerkLogs",
    "PingLimit",
    "PlayerBumpPlayer",
    "PlayerRespawnWithOther",
    "PlayerRespawnWithSelf",
    "PlayerSafehouse",
    "Public",
    "PublicDescription",
    "PublicName",
    "RCONPassword",
    "RCONPort",
    "RemovePlayerCorpsesOnCorpseRemoval",
    "ResetID",
    "SafeHouseRemovalTime",
    "SafehouseAllowFire",
    "SafehouseAllowLoot",
    "SafehouseAllowNonResidential",
    "SafehouseAllowRespawn",
    "SafehouseAllowTrepass",
    "SafehouseDaySurvivedToClaim",
    "SafehouseDisableDisguises",
    "SafehousePreventsLootRespawn",
    "SafetyCooldownTimer",
    "SafetyDisconnectDelay",
    "SafetySystem",
    "SafetyToggleTimer",
    "SaveWorldEveryMinutes",
    "Seed",
    "ServerPlayerID",
    "ServerWelcomeMessage",
    "ShowFirstAndLastName",
    "ShowSafety",
    "SledgehammerOnlyInSafehouse",
    "SleepAllowed",
    "SleepNeeded",
    "SneakModeHideFromOtherPlayers",
    "SpawnItems",
    "SpawnPoint",
    "SpeedLimit",
    "SteamScoreboard",
    "SteamVAC",
    "SwitchZombiesOwnershipEachUpdate",
    "TrashDeleteAll",
    "UDPPort",
    "UPnP",
    "UltraSpeedDoesnotAffectToAnimals",
    "UsePhysicsHitReaction",
    "UsernameDisguises",
    "VoiceEnable",
    "VoiceMaxDistance",
    "VoiceMinDistance",
    "War",
    "WarDuration",
    "WarSafehouseHitPoints",
    "WarStartDelay",
    "WebhookAddress",
    "WorkshopItems",
    "server_browser_announced_ip",
  ] as const;

  it("every live ini key has a curated descriptor (not the 'other' fallback)", () => {
    const uncurated: string[] = [];
    for (const key of LIVE_INI_KEYS) {
      const d = describeIni(key);
      if (d.group === "other") uncurated.push(key);
    }
    expect(uncurated).toEqual([]);
  });

  it("sensitive keys are flagged as secret", () => {
    expect(INI_DESCRIPTORS.RCONPassword?.secret).toBe(true);
    expect(INI_DESCRIPTORS.Password?.secret).toBe(true);
    expect(INI_DESCRIPTORS.DiscordToken?.secret).toBe(true);
  });

  it("unknown keys fall back to the 'other' group without throwing", () => {
    const d = describeIni("ThisIsNotARealKey_12345");
    expect(d.group).toBe("other");
    expect(d.description).toMatch(/pzwiki/i);
  });
});
