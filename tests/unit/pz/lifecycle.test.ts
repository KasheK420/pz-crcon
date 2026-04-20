/**
 * Unit tests for `lib/server/lifecycle.ts`.
 *
 * We mock the docker control client and the rcon command helpers so the
 * orchestrator's phase sequence can be verified without standing up a
 * Docker daemon or an RCON server. `publish` is mocked to capture the
 * WS broadcasts.
 */

import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";

const publishMock = vi.fn();

vi.mock("@/lib/ws/server", () => ({
  publish: (channel: string, data: unknown) => publishMock(channel, data),
}));

vi.mock("@/lib/logger", () => ({
  getLogger: () => ({
    child: () => ({
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    }),
  }),
}));

const inspectPzMock = vi.fn();
const isProxyReachableMock = vi.fn();
const startPzMock = vi.fn();
const stopPzMock = vi.fn();
const killPzMock = vi.fn();
const waitForStateMock = vi.fn();

vi.mock("@/lib/docker/control", () => ({
  inspectPz: () => inspectPzMock(),
  isProxyReachable: () => isProxyReachableMock(),
  startPz: () => startPzMock(),
  stopPz: (t: number) => stopPzMock(t),
  killPz: () => killPzMock(),
  restartPz: () => Promise.resolve(),
  waitForState: (want: "running" | "exited", ms: number) =>
    waitForStateMock(want, ms),
}));

const servermsgMock = vi.fn();
const saveWorldMock = vi.fn();
const quitServerMock = vi.fn();

vi.mock("@/lib/rcon/server-commands", () => ({
  servermsg: (t: string) => servermsgMock(t),
  saveWorld: (ms?: number) => saveWorldMock(ms),
  quitServer: () => quitServerMock(),
  reloadOptions: () => Promise.resolve("ok"),
  rconPing: () => Promise.resolve(true),
}));

vi.mock("@/lib/pz/writer", () => ({
  registerLifecyclePhaseGetter: () => {},
}));

type PublishedPhase = { phase: string; detail?: string };

function phases(): PublishedPhase[] {
  return publishMock.mock.calls
    .filter((c) => c[0] === "server:lifecycle")
    .map((c) => c[1] as PublishedPhase);
}

beforeEach(() => {
  vi.useFakeTimers();
  publishMock.mockReset();
  inspectPzMock.mockReset();
  isProxyReachableMock.mockReset();
  startPzMock.mockReset();
  stopPzMock.mockReset();
  killPzMock.mockReset();
  waitForStateMock.mockReset();
  servermsgMock.mockReset();
  saveWorldMock.mockReset();
  quitServerMock.mockReset();

  // Sensible happy-path defaults — individual tests override.
  isProxyReachableMock.mockResolvedValue(true);
  inspectPzMock.mockResolvedValue({ running: true, status: "running" });
  servermsgMock.mockResolvedValue("ok");
  saveWorldMock.mockResolvedValue({ ok: true, response: "saved" });
  quitServerMock.mockResolvedValue("ok");
  waitForStateMock.mockResolvedValue(true);
  startPzMock.mockResolvedValue(undefined);
  stopPzMock.mockResolvedValue(undefined);
  killPzMock.mockResolvedValue(undefined);
});

afterEach(async () => {
  vi.useRealTimers();
  vi.resetModules();
});

/**
 * Drive the microtask queue and all pending timers to completion. Returns
 * the awaited restart/stop promise result.
 */
async function runAllTimers<T>(p: Promise<T>): Promise<T> {
  // `vi.runAllTimersAsync` advances timers while awaiting microtasks, which
  // is required because our restart flow interleaves RCON-awaits and
  // setTimeout-based countdowns.
  await vi.runAllTimersAsync();
  return p;
}

describe("gracefulRestart", () => {
  it("emits warning → saving → stopping → starting → idle on happy path", async () => {
    const { gracefulRestart, __resetLifecycleStateForTests } = await import(
      "@/lib/server/lifecycle"
    );
    __resetLifecycleStateForTests();

    inspectPzMock
      .mockResolvedValueOnce({ running: true, status: "running" })
      .mockResolvedValue({ running: true, status: "running" });

    await runAllTimers(gracefulRestart(2));

    const seq = phases().map((p) => p.phase);
    expect(seq).toContain("warning");
    expect(seq).toContain("saving");
    expect(seq).toContain("stopping");
    expect(seq).toContain("starting");
    expect(seq[seq.length - 1]).toBe("idle");
    expect(phases()[phases().length - 1]?.detail).toBeUndefined();

    expect(servermsgMock).toHaveBeenCalledOnce();
    expect(saveWorldMock).toHaveBeenCalledOnce();
    expect(quitServerMock).toHaveBeenCalledOnce();
    expect(startPzMock).toHaveBeenCalledOnce();
  });

  it("returns LifecycleBusyError when another operation is in flight", async () => {
    const { gracefulRestart, LifecycleBusyError, __resetLifecycleStateForTests } =
      await import("@/lib/server/lifecycle");
    __resetLifecycleStateForTests();

    inspectPzMock.mockResolvedValue({ running: true, status: "running" });
    // Force the first call to get past the mutex.isLocked() guard but
    // stall inside the flow — we make waitForState hang so the second
    // call sees the mutex as locked.
    let releaseWait!: () => void;
    waitForStateMock.mockImplementationOnce(
      () =>
        new Promise<boolean>((r) => {
          releaseWait = () => r(true);
        }),
    );

    const first = gracefulRestart(1);
    // Let the first call reach the mutex-held state.
    await vi.advanceTimersByTimeAsync(1500);
    await Promise.resolve();

    await expect(gracefulRestart(1)).rejects.toBeInstanceOf(LifecycleBusyError);

    releaseWait();
    await runAllTimers(first);
  });

  it("emits save-timeout-proceeding and continues to stop when save races out", async () => {
    const { gracefulRestart, __resetLifecycleStateForTests } = await import(
      "@/lib/server/lifecycle"
    );
    __resetLifecycleStateForTests();

    saveWorldMock.mockResolvedValue({ ok: false, response: "save-timeout" });

    await runAllTimers(gracefulRestart(1));

    const savingFrames = phases().filter((p) => p.phase === "saving");
    expect(savingFrames.length).toBeGreaterThanOrEqual(2);
    expect(savingFrames.some((f) => f.detail === "save-timeout-proceeding")).toBe(
      true,
    );
    expect(quitServerMock).toHaveBeenCalledOnce();
    expect(startPzMock).toHaveBeenCalledOnce();
  });

  it("continues cleanly when RCON is down (servermsg throws)", async () => {
    const { gracefulRestart, __resetLifecycleStateForTests } = await import(
      "@/lib/server/lifecycle"
    );
    __resetLifecycleStateForTests();

    servermsgMock.mockRejectedValue(new Error("econnrefused"));
    quitServerMock.mockRejectedValue(new Error("econnrefused"));

    await runAllTimers(gracefulRestart(1));

    const seq = phases().map((p) => p.phase);
    expect(seq).toContain("stopping");
    expect(seq).toContain("starting");
    expect(seq[seq.length - 1]).toBe("idle");
    expect(startPzMock).toHaveBeenCalledOnce();
  });

  it("aborts during warning phase when abortCurrent() is called", async () => {
    const {
      gracefulRestart,
      abortCurrent,
      __resetLifecycleStateForTests,
    } = await import("@/lib/server/lifecycle");
    __resetLifecycleStateForTests();

    const p = gracefulRestart(30).catch((e) => e);
    // Let the warning phase begin (servermsg awaits + 1s into countdown).
    await vi.advanceTimersByTimeAsync(2000);
    abortCurrent();
    const result = await runAllTimers(p);
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toBe("aborted");

    const seq = phases().map((p) => p.phase);
    expect(seq[0]).toBe("warning");
    // Abort should NOT have triggered save/stop; flow threw at the
    // countdown checkpoint.
    expect(saveWorldMock).not.toHaveBeenCalled();
    expect(quitServerMock).not.toHaveBeenCalled();
    expect(seq[seq.length - 1]).toBe("idle");
  });

  it("skips the stop sequence when container is not running", async () => {
    const { gracefulRestart, __resetLifecycleStateForTests } = await import(
      "@/lib/server/lifecycle"
    );
    __resetLifecycleStateForTests();

    inspectPzMock.mockResolvedValue({ running: false, status: "exited" });

    await runAllTimers(gracefulRestart(1));

    expect(servermsgMock).not.toHaveBeenCalled();
    expect(saveWorldMock).not.toHaveBeenCalled();
    expect(quitServerMock).not.toHaveBeenCalled();
    const seq = phases().map((p) => p.phase);
    expect(seq[0]).toBe("starting");
    expect(seq[seq.length - 1]).toBe("idle");
  });
});
