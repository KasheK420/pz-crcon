import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { envMapFrom, inspectContainer } from "@/lib/docker/client";
import { parseIni, type ParsedIni } from "./parse-ini";
import { parseSandboxLua, type ParsedSandbox } from "./parse-sandbox-lua";

const PZ_CONTAINER = process.env.PZ_CONTAINER_NAME ?? "pz-server";
const configDir = () => process.env.PZ_CONFIG_DIR ?? "/pz-data/Server";

/**
 * Look up the server-config "prefix" (the value of the SERVERNAME env
 * var, defaulting to `servertest`). The PZ files on disk are named
 * `<prefix>.ini` and `<prefix>_SandboxVars.lua`.
 *
 * Falls back to the `PZ_SERVER_PREFIX` env override when the docker
 * socket isn't reachable (e.g. local dev without a mounted socket).
 */
export async function detectServerPrefix(): Promise<string> {
  const override = process.env.PZ_SERVER_PREFIX?.trim();
  if (override) return override;
  const info = await inspectContainer(PZ_CONTAINER);
  if (!info) return "servertest";
  const env = envMapFrom(info);
  return env.SERVERNAME?.trim() || "servertest";
}

export interface ServerIniResult {
  ok: boolean;
  prefix: string;
  path: string;
  mtimeMs?: number;
  parsed?: ParsedIni;
  raw?: string;
  error?: string;
}

export async function readServerIni(): Promise<ServerIniResult> {
  const prefix = await detectServerPrefix();
  const path = join(configDir(), `${prefix}.ini`);
  try {
    const raw = await readFile(path, "utf8");
    const { mtimeMs } = await stat(path);
    return { ok: true, prefix, path, mtimeMs, parsed: parseIni(raw), raw };
  } catch (e) {
    return { ok: false, prefix, path, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface SandboxVarsResult {
  ok: boolean;
  prefix: string;
  path: string;
  mtimeMs?: number;
  parsed?: ParsedSandbox;
  raw?: string;
  error?: string;
}

export async function readSandboxVars(): Promise<SandboxVarsResult> {
  const prefix = await detectServerPrefix();
  const path = join(configDir(), `${prefix}_SandboxVars.lua`);
  try {
    const raw = await readFile(path, "utf8");
    const { mtimeMs } = await stat(path);
    return { ok: true, prefix, path, mtimeMs, parsed: parseSandboxLua(raw), raw };
  } catch (e) {
    return { ok: false, prefix, path, error: e instanceof Error ? e.message : String(e) };
  }
}
