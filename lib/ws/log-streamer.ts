/**
 * On-demand `docker logs -f pz-server` tailer.
 *
 * Wires into the WS subscriber-count hook so we only spin up the dockerode
 * follow stream when at least one MODERATOR+ client is watching `logs:server`,
 * and tear it down once they all disconnect or unsubscribe. Saves Docker
 * socket churn when nobody's looking at the log viewer.
 */

import { onSubscriberChange, publish } from "@/lib/ws/server";
import { tailContainerLogs } from "@/lib/docker/client";
import { getLogger } from "@/lib/logger";

const log = () => getLogger().child({ mod: "ws/log-streamer" });

const ANSI_RE = /\x1b\[[0-9;]*m/g;

const PZ_SERVER_NAME = process.env.PZ_SERVER_CONTAINER ?? "pz-server";

let active: { close: () => void } | null = null;
let buffered = ""; // partial line carry between chunks

// PZ logs occasionally print "TPS: 30.0" (or similar). We sample the
// most recent occurrence so /api/status can surface an approximate
// server tickrate without a separate Lua mod.
const TPS_RE = /TPS[:=\s]+([0-9]+(?:\.[0-9]+)?)/i;
let lastTps: { value: number; at: number } | null = null;

export function getLastTps(maxAgeMs = 60_000): number | null {
  if (!lastTps) return null;
  if (Date.now() - lastTps.at > maxAgeMs) return null;
  return lastTps.value;
}

function emitLine(raw: string): void {
  const clean = raw.replace(ANSI_RE, "").trimEnd();
  if (!clean) return;
  const tpsMatch = TPS_RE.exec(clean);
  if (tpsMatch) {
    const v = Number(tpsMatch[1]);
    if (Number.isFinite(v)) lastTps = { value: v, at: Date.now() };
  }
  publish("logs:server", { line: clean, ts: Date.now() });
}

async function startTail(): Promise<void> {
  if (active) return;
  log().info({ container: PZ_SERVER_NAME }, "starting docker logs tail");
  const res = await tailContainerLogs(PZ_SERVER_NAME, { tail: 200 });
  if (!res.ok) {
    const diag =
      res.reason === "socket"
        ? `[pz-crcon] Docker socket unavailable — cannot tail "${PZ_SERVER_NAME}" (${res.detail})`
        : res.reason === "container"
          ? `[pz-crcon] container "${PZ_SERVER_NAME}" unreachable — ${res.detail}`
          : `[pz-crcon] could not attach to "${PZ_SERVER_NAME}" logs — ${res.detail}`;
    log().warn({ container: PZ_SERVER_NAME, reason: res.reason, detail: res.detail }, diag);
    publish("logs:server", { line: diag, ts: Date.now() });
    return;
  }
  const handle = res.handle;
  active = handle;
  buffered = "";

  handle.stream.on("data", (chunk: Buffer) => {
    // pz-server runs with TTY=true so logs are plain text (no Docker
    // multiplexed stream framing). If TTY is later disabled, the first
    // 8 bytes of each frame would be a header and we'd need to strip
    // them — for now treating chunks as plain text is correct.
    const text = buffered + chunk.toString("utf8");
    const lines = text.split(/\r?\n/);
    buffered = lines.pop() ?? "";
    for (const line of lines) emitLine(line);
  });
  handle.stream.on("end", () => {
    if (buffered) emitLine(buffered);
    log().info("docker logs tail ended");
    active = null;
  });
  handle.stream.on("error", (e: Error) => {
    log().warn({ err: e }, "docker logs tail error");
    active = null;
  });
}

function stopTail(): void {
  if (!active) return;
  log().info("stopping docker logs tail (no subscribers)");
  active.close();
  active = null;
  buffered = "";
}

let installed = false;
let dispose: (() => void) | null = null;

/** Install the subscriber-count hook. Idempotent. */
export function installLogStreamer(): void {
  if (installed) return;
  installed = true;
  dispose = onSubscriberChange((channel, count) => {
    if (channel !== "logs:server") return;
    if (count > 0 && !active) {
      void startTail();
    } else if (count === 0 && active) {
      stopTail();
    }
  });
}

/** Test/teardown helper. */
export function uninstallLogStreamer(): void {
  if (!installed) return;
  installed = false;
  if (dispose) dispose();
  dispose = null;
  stopTail();
}
