import { Rcon } from "rcon-client";
import { loadEnv } from "@/lib/env";
import { getLogger } from "@/lib/logger";

const log = () => getLogger().child({ mod: "rcon" });

let _rcon: Rcon | null = null;
let _connecting: Promise<Rcon> | null = null;

async function connect(): Promise<Rcon> {
  if (_rcon) return _rcon;
  if (_connecting) return _connecting;
  const env = loadEnv();
  _connecting = (async () => {
    try {
      const r = new Rcon({
        host: env.RCON_HOST,
        port: env.RCON_PORT,
        password: env.RCON_PASSWORD,
        timeout: 5000,
      });
      await r.connect();
      log().info({ host: env.RCON_HOST, port: env.RCON_PORT }, "rcon connected");
      r.on("end", () => {
        log().warn("rcon connection ended; will reconnect on next command");
        _rcon = null;
      });
      r.on("error", (e) => {
        log().error({ err: e }, "rcon error");
      });
      _rcon = r;
      return r;
    } finally {
      _connecting = null;
    }
  })();
  return _connecting;
}

export async function rconExecute(command: string): Promise<string> {
  const start = Date.now();
  let conn: Rcon;
  try {
    conn = await connect();
  } catch (e) {
    log().error({ err: e }, "rcon connect failed");
    throw e;
  }
  try {
    const out = await conn.send(command);
    log().info({ command, ms: Date.now() - start }, "rcon ok");
    return out;
  } catch (e) {
    log().error({ command, err: e }, "rcon send failed");
    // Force reconnect AND release the leaked socket.
    try {
      await conn.end();
    } catch {
      // ignore
    }
    _rcon = null;
    throw e;
  }
}

export async function rconClose(): Promise<void> {
  if (_rcon) {
    await _rcon.end();
    _rcon = null;
  }
}
