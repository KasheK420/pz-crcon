/**
 * Server lifecycle orchestrator.
 *
 * Coordinates the graceful start/stop/restart of the `pz-server` container
 * via the Docker control client (TCP to docker-socket-proxy) and the RCON
 * helper layer.
 *
 * Guarantees:
 *   - A single operation is in flight at any time (module-level mutex).
 *     Concurrent callers get a `LifecycleBusyError` *before* the mutex is
 *     acquired — so there is never a queue of pending restarts.
 *   - Every state transition is broadcast on the WS `server:lifecycle`
 *     channel via `publish()`. The last `emit()` of every flow is
 *     `idle` (success) or `idle` with an error detail (failure).
 *   - The PZ config writer (`lib/pz/writer.ts`) reads the current phase
 *     via `registerLifecyclePhaseGetter(getPhase)` so writes are blocked
 *     while a restart is in progress.
 *
 * Abort semantics (important):
 *   - `abortCurrent()` sets `abortSignalled = true`. Only the *warning*
 *     phase's 1-second sleep loop observes the flag. Aborting during
 *     `saving` or `stopping` is ignored — halting mid-save or mid-stop
 *     would corrupt the world file or leave the container in a wedged
 *     state. Operators who want to force-kill a misbehaving stop use
 *     `forceStop()` instead.
 */

import { Mutex } from "async-mutex";
import { publish } from "@/lib/ws/server";
import type { LifecyclePayload } from "@/lib/ws/channels";
import { quitServer, saveWorld, servermsg } from "@/lib/rcon/server-commands";
import {
  inspectPz,
  isProxyReachable,
  killPz,
  startPz,
  stopPz,
  waitForState,
} from "@/lib/docker/control";
import { registerLifecyclePhaseGetter } from "@/lib/pz/writer";
import {
  restorePzConfig,
  snapshotPzConfig,
  type PzConfigSnapshot,
} from "@/lib/pz/snapshot";
import { getLogger } from "@/lib/logger";

const log = () => getLogger().child({ mod: "lifecycle" });

export type Phase = LifecyclePayload["phase"];

let phase: Phase = "idle";
let phaseDetail: string | undefined;
let abortSignalled = false;

export function getPhase(): Phase {
  return phase;
}

export function getDetail(): string | undefined {
  return phaseDetail;
}

// Feed the current phase string to the writer so it can refuse writes
// while a lifecycle operation is mid-flight.
registerLifecyclePhaseGetter(getPhase);

function emit(p: Phase, detail?: string): void {
  phase = p;
  phaseDetail = detail;
  const payload: LifecyclePayload = { phase: p, detail, at: Date.now() };
  publish("server:lifecycle", payload);
  log().info({ phase: p, detail }, "lifecycle phase");
}

const mutex = new Mutex();

export class LifecycleBusyError extends Error {
  code = "lifecycle-busy" as const;
  constructor() {
    super("another lifecycle operation is in progress");
    this.name = "LifecycleBusyError";
  }
}

export class ProxyUnreachableError extends Error {
  code = "proxy-unreachable" as const;
  constructor() {
    super("docker-socket-proxy is not reachable");
    this.name = "ProxyUnreachableError";
  }
}

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const release = await mutex.acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}

/**
 * Flag the current operation to abort at its next checkpoint. Only the
 * warning-phase sleep loop observes this; saves/stops are atomic.
 */
export function abortCurrent(): void {
  if (phase === "idle") return;
  abortSignalled = true;
  log().warn({ phase }, "lifecycle abort requested");
}

async function warningCountdown(seconds: number): Promise<void> {
  for (let i = 0; i < seconds; i++) {
    if (abortSignalled) throw new Error("aborted");
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function announce(
  kind: "restart" | "stop",
  seconds: number,
  reason = "config reload",
): Promise<void> {
  try {
    if (kind === "restart") {
      await servermsg(
        `Server restarting in ${seconds}s (${reason}). Please log out.`,
      );
    } else {
      await servermsg(`Server stopping in ${seconds}s. Please log out.`);
    }
  } catch {
    // RCON may already be down — continue with the rest of the flow.
  }
}

/**
 * Graceful stop path: warn → snapshot config → save → quit → wait
 * exited → fallback stop/kill → restore config. Shared by
 * `gracefulRestart` and `gracefulStop`; throws if the warning phase
 * is aborted.
 *
 * The config snapshot+restore dance is critical: PZ writes
 * `<prefix>.ini` and `<prefix>_SandboxVars.lua` back from its
 * in-memory state on RCON `save`/`quit` and on shutdown signals.
 * Without this dance, any FS-level edit the admin made while the
 * server was running would be silently reverted when they clicked
 * Restart. See `lib/pz/snapshot.ts` for details.
 */
async function gracefulShutdownSequence(
  warningSeconds: number,
  kind: "restart" | "stop" = "restart",
): Promise<PzConfigSnapshot> {
  emit("warning", `${warningSeconds}s`);
  await announce(kind, warningSeconds);
  await warningCountdown(warningSeconds);

  // Snapshot right before PZ gets any chance to persist its memory
  // back over our files. The edited bytes are already on disk.
  const snap = await snapshotPzConfig();

  emit("saving");
  const saveRes = await saveWorld(120_000);
  if (!saveRes.ok) emit("saving", "save-timeout-proceeding");

  emit("stopping");
  try {
    await quitServer();
  } catch {
    // ignore — we'll fall back to docker stop/kill.
  }
  const exited = await waitForState("exited", 90_000);
  if (!exited) {
    await stopPz(30);
    const stopped2 = await waitForState("exited", 35_000);
    if (!stopped2) await killPz();
  }

  // PZ is now definitely not running. Put our config back over
  // whatever it may have left behind on shutdown.
  try {
    const out = await restorePzConfig(snap);
    if (out.ini?.clobbered || out.sandbox?.clobbered) {
      emit("stopping", "config-restored");
    }
  } catch (e) {
    log().error(
      { err: e instanceof Error ? e.message : String(e) },
      "config restore after shutdown failed",
    );
  }
  return snap;
}

/**
 * Orchestrate a graceful restart:
 *   warning → saving → stopping → starting → idle
 *
 * On RCON-down: `servermsg`/`quit` errors are swallowed; the docker
 * layer handles the actual stop. On save-timeout: proceeds to stop
 * but emits `save-timeout-proceeding` as a breadcrumb.
 */
export async function gracefulRestart(warningSeconds = 30): Promise<void> {
  if (!(await isProxyReachable())) throw new ProxyUnreachableError();
  if (mutex.isLocked()) throw new LifecycleBusyError();
  return withLock(async () => {
    abortSignalled = false;
    try {
      const probe = await inspectPz();
      const running = probe?.running ?? false;
      if (running) {
        await gracefulShutdownSequence(warningSeconds);
      }
      emit("starting");
      await startPz();
      const up = await waitForState("running", 600_000);
      if (!up) {
        emit("idle", "start-failed");
        return;
      }
      // Post-start settle: crash-loop guard. If the container exits
      // inside 30s, surface as a start failure.
      await new Promise((r) => setTimeout(r, 30_000));
      const finalState = await inspectPz();
      emit(
        "idle",
        finalState?.running
          ? undefined
          : `start-failed exit=${finalState?.exitCode ?? "?"}`,
      );
    } catch (e) {
      emit("idle", `error ${e instanceof Error ? e.message : String(e)}`);
      throw e;
    }
  });
}

/**
 * Graceful stop — same as restart but without the re-start step.
 * Reuses `gracefulShutdownSequence` so the snapshot+restore of the
 * PZ config files is applied identically (otherwise an admin who
 * edited config and then hit Stop would lose their edits on the
 * next manual Start).
 */
export async function gracefulStop(warningSeconds = 30): Promise<void> {
  if (!(await isProxyReachable())) throw new ProxyUnreachableError();
  if (mutex.isLocked()) throw new LifecycleBusyError();
  return withLock(async () => {
    abortSignalled = false;
    try {
      const probe = await inspectPz();
      const running = probe?.running ?? false;
      if (!running) {
        emit("idle");
        return;
      }
      // The restart path wraps the shutdown in a snapshot+restore
      // cycle; stop has the same requirement so that subsequent
      // starts (manual or via lifecycle) read the edited config.
      await gracefulShutdownSequence(warningSeconds, "stop");
      emit("idle");
    } catch (e) {
      emit("idle", `error ${e instanceof Error ? e.message : String(e)}`);
      throw e;
    }
  });
}

/**
 * Start the container if it is currently stopped. No-op if already
 * running. Surfaces `start-failed` in the idle detail if the container
 * fails to reach the running state within 10 minutes.
 */
export async function startIfStopped(): Promise<void> {
  if (!(await isProxyReachable())) throw new ProxyUnreachableError();
  if (mutex.isLocked()) throw new LifecycleBusyError();
  return withLock(async () => {
    abortSignalled = false;
    try {
      const probe = await inspectPz();
      if (probe?.running) {
        emit("idle");
        return;
      }
      emit("starting");
      await startPz();
      const up = await waitForState("running", 600_000);
      if (!up) {
        emit("idle", "start-failed");
        return;
      }
      await new Promise((r) => setTimeout(r, 30_000));
      const finalState = await inspectPz();
      emit(
        "idle",
        finalState?.running
          ? undefined
          : `start-failed exit=${finalState?.exitCode ?? "?"}`,
      );
    } catch (e) {
      emit("idle", `error ${e instanceof Error ? e.message : String(e)}`);
      throw e;
    }
  });
}

/**
 * Hard-kill the container. No RCON, no save — operator breaks glass.
 * OWNER-only at the route layer; this module just executes.
 */
export async function forceStop(): Promise<void> {
  if (!(await isProxyReachable())) throw new ProxyUnreachableError();
  if (mutex.isLocked()) throw new LifecycleBusyError();
  return withLock(async () => {
    abortSignalled = false;
    try {
      emit("stopping", "force");
      try {
        await killPz();
      } catch {
        // Container may already be down.
      }
      await waitForState("exited", 35_000);
      emit("idle", "force-stopped");
    } catch (e) {
      emit("idle", `error ${e instanceof Error ? e.message : String(e)}`);
      throw e;
    }
  });
}

/**
 * Test helper — restore module-level state between tests. Not part of
 * the runtime surface.
 */
export function __resetLifecycleStateForTests(): void {
  phase = "idle";
  phaseDetail = undefined;
  abortSignalled = false;
}
