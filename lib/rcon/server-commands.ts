// Do NOT import this module from client components. It pulls in
// `rcon-client`, which depends on Node's `net` module and must stay on the
// server. If you need command metadata on the client, import from
// `./commands` (catalog-only) instead.
import { rconExecute } from "./client";

// ---------------------------------------------------------------------------
// Typed helpers used by the lifecycle orchestrator and other server code.
//
// These wrap `rconExecute` so callers can pass already-sanitised arguments
// (the helpers do the escaping themselves) and so the lifecycle module can
// depend on a small, stable surface instead of building command strings
// inline.
//
// Kept in a dedicated server-only module because `rconExecute` pulls in
// `rcon-client`, which transitively requires Node's `net` module and must
// never end up in the client bundle.
// ---------------------------------------------------------------------------

/** Broadcast an in-game server message to all connected players. */
export async function servermsg(text: string): Promise<string> {
  return rconExecute(`servermsg "${text.replace(/"/g, '\\"')}"`);
}

/**
 * Trigger a world-save via RCON. Races against `timeoutMs` so a hung save
 * doesn't block the lifecycle; on timeout we surface `ok: false` but do not
 * throw — the caller can decide to proceed to a hard stop.
 */
export async function saveWorld(
  timeoutMs = 120_000,
): Promise<{ ok: boolean; response: string }> {
  try {
    const r = await Promise.race([
      rconExecute("save"),
      new Promise<string>((_, rej) =>
        setTimeout(() => rej(new Error("save-timeout")), timeoutMs),
      ),
    ]);
    return { ok: true, response: r };
  } catch (e) {
    return { ok: false, response: e instanceof Error ? e.message : String(e) };
  }
}

/** Ask the PZ server to shut itself down gracefully. */
export async function quitServer(): Promise<string> {
  return rconExecute("quit");
}

/** Reload server.ini options live (subset of keys only). */
export async function reloadOptions(): Promise<string> {
  return rconExecute("reloadoptions");
}

/**
 * Fast RCON liveness check used by the state endpoint. Races `showoptions`
 * against a short timeout and returns a boolean; never throws.
 */
export async function rconPing(timeoutMs = 2_000): Promise<boolean> {
  try {
    await Promise.race([
      rconExecute("showoptions"),
      new Promise<string>((_, rej) =>
        setTimeout(() => rej(new Error("rcon-ping-timeout")), timeoutMs),
      ),
    ]);
    return true;
  } catch {
    return false;
  }
}
