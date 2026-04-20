/**
 * When the docker-socket-proxy is unreachable, lifecycle ops must throw
 * `ProxyUnreachableError` *before* emitting any phase change or acquiring
 * the mutex. This test guards that contract so operators don't see phantom
 * "warning" phases on a broken proxy.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

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

const isProxyReachableMock = vi.fn();
const inspectPzMock = vi.fn();
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

vi.mock("@/lib/rcon/server-commands", () => ({
  servermsg: () => Promise.resolve("ok"),
  saveWorld: () => Promise.resolve({ ok: true, response: "saved" }),
  quitServer: () => Promise.resolve("ok"),
  reloadOptions: () => Promise.resolve("ok"),
  rconPing: () => Promise.resolve(true),
}));

vi.mock("@/lib/pz/writer", () => ({
  registerLifecyclePhaseGetter: () => {},
}));

beforeEach(() => {
  publishMock.mockReset();
  isProxyReachableMock.mockReset();
  inspectPzMock.mockReset();
  startPzMock.mockReset();
  stopPzMock.mockReset();
  killPzMock.mockReset();
  waitForStateMock.mockReset();
});

describe("gracefulRestart — proxy down", () => {
  it("throws ProxyUnreachableError and publishes no phase change", async () => {
    const { gracefulRestart, ProxyUnreachableError, __resetLifecycleStateForTests } =
      await import("@/lib/server/lifecycle");
    __resetLifecycleStateForTests();

    isProxyReachableMock.mockResolvedValue(false);

    await expect(gracefulRestart(1)).rejects.toBeInstanceOf(
      ProxyUnreachableError,
    );
    expect(publishMock).not.toHaveBeenCalled();
    expect(inspectPzMock).not.toHaveBeenCalled();
    expect(startPzMock).not.toHaveBeenCalled();
  });

  it("also guards gracefulStop and startIfStopped", async () => {
    const {
      gracefulStop,
      startIfStopped,
      forceStop,
      ProxyUnreachableError,
      __resetLifecycleStateForTests,
    } = await import("@/lib/server/lifecycle");
    __resetLifecycleStateForTests();

    isProxyReachableMock.mockResolvedValue(false);

    await expect(gracefulStop(1)).rejects.toBeInstanceOf(ProxyUnreachableError);
    await expect(startIfStopped()).rejects.toBeInstanceOf(ProxyUnreachableError);
    await expect(forceStop()).rejects.toBeInstanceOf(ProxyUnreachableError);
    expect(publishMock).not.toHaveBeenCalled();
  });
});
