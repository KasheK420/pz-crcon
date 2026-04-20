import { envMapFrom, inspectContainer, readContainerFile } from "@/lib/docker/client";
import { parseIni, type ParsedIni } from "./parse-ini";
import { parseSandboxLua, type ParsedSandbox } from "./parse-sandbox-lua";

const PZ_CONTAINER = process.env.PZ_CONTAINER_NAME ?? "pz-server";
const SERVER_DIR = process.env.PZ_SERVER_DIR ?? "/home/steam/Zomboid/Server";

/**
 * Look up the server-config "prefix" (the value of the SERVERNAME env
 * var, defaulting to `servertest`). The PZ files on disk are named
 * `<prefix>.ini` and `<prefix>_SandboxVars.lua`.
 */
export async function detectServerPrefix(): Promise<string> {
  const info = await inspectContainer(PZ_CONTAINER);
  if (!info) return "servertest";
  const env = envMapFrom(info);
  return env.SERVERNAME?.trim() || "servertest";
}

export interface ServerIniResult {
  ok: boolean;
  prefix: string;
  path: string;
  parsed?: ParsedIni;
  raw?: string;
  error?: string;
}

export async function readServerIni(): Promise<ServerIniResult> {
  const prefix = await detectServerPrefix();
  const path = `${SERVER_DIR}/${prefix}.ini`;
  const raw = await readContainerFile(PZ_CONTAINER, path);
  if (raw === null) {
    return { ok: false, prefix, path, error: `Could not read ${path}` };
  }
  return { ok: true, prefix, path, parsed: parseIni(raw), raw };
}

export interface SandboxVarsResult {
  ok: boolean;
  prefix: string;
  path: string;
  parsed?: ParsedSandbox;
  raw?: string;
  error?: string;
}

export async function readSandboxVars(): Promise<SandboxVarsResult> {
  const prefix = await detectServerPrefix();
  const path = `${SERVER_DIR}/${prefix}_SandboxVars.lua`;
  const raw = await readContainerFile(PZ_CONTAINER, path);
  if (raw === null) {
    return { ok: false, prefix, path, error: `Could not read ${path}` };
  }
  return { ok: true, prefix, path, parsed: parseSandboxLua(raw), raw };
}
