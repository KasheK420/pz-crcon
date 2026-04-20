/**
 * Docker control client — talks to `tecnativa/docker-socket-proxy` over TCP.
 *
 * Separate from `lib/docker/client.ts` (which uses the raw socket with only
 * non-mutating calls). The proxy limits which endpoints are reachable via
 * env flags (CONTAINERS_START=1, CONTAINERS_STOP=1, etc.), so even if this
 * module tried to call something dangerous, the proxy would 403.
 *
 * Exposes start/stop/restart/kill on the `pz-server` container plus
 * `inspect`/`ping`/`waitForState` helpers used by the lifecycle orchestrator.
 */

import Docker from "dockerode";
import { getLogger } from "@/lib/logger";

const log = () => getLogger().child({ mod: "docker/control" });

let _ctl: Docker | null = null;

function getCtl(): Docker {
  if (_ctl) return _ctl;
  const raw = process.env.DOCKER_CONTROL_URL ?? "http://docker-socket-proxy:2375";
  const url = new URL(raw);
  _ctl = new Docker({
    host: url.hostname,
    port: Number(url.port || 2375),
    protocol: "http",
  });
  log().info({ host: url.hostname, port: url.port || 2375 }, "docker control client configured");
  return _ctl;
}

const PZ_NAME = (): string => process.env.PZ_CONTAINER_NAME ?? "pz-server";

export interface PzInspect {
  running: boolean;
  status: string;
  exitCode?: number;
}

export async function isProxyReachable(): Promise<boolean> {
  try {
    await getCtl().ping();
    return true;
  } catch (e) {
    log().warn({ err: e instanceof Error ? e.message : String(e) }, "proxy ping failed");
    return false;
  }
}

export async function inspectPz(): Promise<PzInspect | null> {
  try {
    const info = await getCtl().getContainer(PZ_NAME()).inspect();
    return {
      running: !!info.State?.Running,
      status: info.State?.Status ?? "unknown",
      exitCode: info.State?.ExitCode,
    };
  } catch (e) {
    log().warn({ err: e instanceof Error ? e.message : String(e) }, "inspectPz failed");
    return null;
  }
}

export async function startPz(): Promise<void> {
  await getCtl().getContainer(PZ_NAME()).start();
}

export async function stopPz(timeoutS = 30): Promise<void> {
  await getCtl().getContainer(PZ_NAME()).stop({ t: timeoutS });
}

export async function restartPz(timeoutS = 30): Promise<void> {
  await getCtl().getContainer(PZ_NAME()).restart({ t: timeoutS });
}

export async function killPz(): Promise<void> {
  await getCtl().getContainer(PZ_NAME()).kill();
}

/**
 * Poll `inspectPz()` until the container reaches the requested state, or
 * the timeout elapses. Returns `true` if the target state was reached.
 * Returns `false` on timeout or if inspect can't find the container.
 */
export async function waitForState(
  want: "running" | "exited",
  timeoutMs: number,
): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const s = await inspectPz();
    if (!s) return false;
    if (want === "running" && s.running) return true;
    if (want === "exited" && !s.running) return true;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}
