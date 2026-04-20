import { access, constants } from "node:fs/promises";
import { getLogger } from "@/lib/logger";

const log = () => getLogger().child({ mod: "pz/access-check" });

let _ok = false;

export function getConfigAccessOk(): boolean {
  return _ok;
}

export interface AccessResult {
  ok: boolean;
  dir: string;
  reason?: string;
}

export async function checkConfigAccess(): Promise<AccessResult> {
  const dir = process.env.PZ_CONFIG_DIR ?? "/pz-data/Server";
  try {
    await access(dir, constants.R_OK | constants.W_OK);
    _ok = true;
    log().info({ dir }, "config dir accessible (r+w)");
    return { ok: true, dir };
  } catch (e) {
    _ok = false;
    const reason = e instanceof Error ? e.message : String(e);
    log().warn({ dir, reason }, "config dir not accessible");
    return { ok: false, dir, reason };
  }
}
