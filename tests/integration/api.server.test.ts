/**
 * Integration tests for the server-lifecycle endpoint matrix:
 *   POST /api/admin/server/start
 *   POST /api/admin/server/stop
 *   POST /api/admin/server/restart
 *   POST /api/admin/server/force-stop
 *   POST /api/admin/server/abort
 *   GET  /api/admin/server/state
 *
 * Lifecycle fns are mocked so we exercise the gate chain (role → CSRF →
 * body validation → lifecycle fn → audit) without standing up a Docker
 * daemon or a real RCON peer.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const sessionMock = vi.fn();
const auditMock = vi.fn();
const gracefulRestartMock = vi.fn();
const gracefulStopMock = vi.fn();
const startIfStoppedMock = vi.fn();
const forceStopMock = vi.fn();
const abortCurrentMock = vi.fn();
const getPhaseMock = vi.fn();
const getDetailMock = vi.fn();
const inspectPzMock = vi.fn();
const isProxyReachableMock = vi.fn();
const rconPingMock = vi.fn();

class LifecycleBusyError extends Error {
  code = "lifecycle-busy" as const;
  constructor() {
    super("busy");
    this.name = "LifecycleBusyError";
  }
}
class ProxyUnreachableError extends Error {
  code = "proxy-unreachable" as const;
  constructor() {
    super("proxy");
    this.name = "ProxyUnreachableError";
  }
}

vi.mock("@/lib/auth/session", () => ({
  getSession: () => sessionMock(),
}));
vi.mock("@/lib/server/audit", () => ({
  recordAudit: (...args: unknown[]) => auditMock(...args),
}));
vi.mock("@/lib/server/lifecycle", () => ({
  gracefulRestart: (s: number) => gracefulRestartMock(s),
  gracefulStop: (s: number) => gracefulStopMock(s),
  startIfStopped: () => startIfStoppedMock(),
  forceStop: () => forceStopMock(),
  abortCurrent: () => abortCurrentMock(),
  getPhase: () => getPhaseMock(),
  getDetail: () => getDetailMock(),
  LifecycleBusyError,
  ProxyUnreachableError,
}));
vi.mock("@/lib/docker/control", () => ({
  inspectPz: () => inspectPzMock(),
  isProxyReachable: () => isProxyReachableMock(),
}));
vi.mock("@/lib/rcon/commands", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rcon/commands")>(
    "@/lib/rcon/commands",
  );
  return {
    ...actual,
    rconPing: (ms?: number) => rconPingMock(ms),
  };
});
vi.mock("@/lib/rcon/client", () => ({
  getFirstConnectAt: () => null,
  rconExecute: () => Promise.resolve(""),
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

const OWNER = { userId: "u-owner", discordId: "d", role: "OWNER" };
const ADMIN = { userId: "u-admin", discordId: "d", role: "ADMIN" };
const VIEWER = { userId: "u-viewer", discordId: "d", role: "VIEWER" };

function makeReq(opts: {
  url: string;
  method?: "POST" | "GET";
  body?: unknown;
  csrfHeader?: string | null;
  csrfCookie?: string | null;
}): NextRequest {
  const {
    url,
    method = "POST",
    body,
    csrfHeader = "tok-abc",
    csrfCookie = "tok-abc|sig",
  } = opts;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (csrfHeader) headers["x-csrf-token"] = csrfHeader;
  if (csrfCookie) {
    headers["cookie"] = `next-auth.csrf-token=${encodeURIComponent(csrfCookie)}`;
  }
  return new NextRequest(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function loadStart() {
  return import("@/app/api/admin/server/start/route");
}
async function loadStop() {
  return import("@/app/api/admin/server/stop/route");
}
async function loadRestart() {
  return import("@/app/api/admin/server/restart/route");
}
async function loadForceStop() {
  return import("@/app/api/admin/server/force-stop/route");
}
async function loadAbort() {
  return import("@/app/api/admin/server/abort/route");
}
async function loadState() {
  return import("@/app/api/admin/server/state/route");
}

beforeEach(() => {
  sessionMock.mockReset();
  auditMock.mockReset();
  gracefulRestartMock.mockReset();
  gracefulStopMock.mockReset();
  startIfStoppedMock.mockReset();
  forceStopMock.mockReset();
  abortCurrentMock.mockReset();
  getPhaseMock.mockReset();
  getDetailMock.mockReset();
  inspectPzMock.mockReset();
  isProxyReachableMock.mockReset();
  rconPingMock.mockReset();
  vi.resetModules();
});

describe("POST /api/admin/server/start", () => {
  it("rejects VIEWER with 403", async () => {
    sessionMock.mockResolvedValue(VIEWER);
    const { POST } = await loadStart();
    const res = await POST(makeReq({ url: "http://localhost/api/admin/server/start" }));
    expect(res.status).toBe(403);
    expect(startIfStoppedMock).not.toHaveBeenCalled();
  });

  it("rejects missing CSRF with 403", async () => {
    sessionMock.mockResolvedValue(ADMIN);
    const { POST } = await loadStart();
    const res = await POST(
      makeReq({
        url: "http://localhost/api/admin/server/start",
        csrfHeader: null,
      }),
    );
    expect(res.status).toBe(403);
    const j = await res.json();
    expect(j.code).toBe("csrf");
  });

  it("calls startIfStopped and audits on success for ADMIN", async () => {
    sessionMock.mockResolvedValue(ADMIN);
    startIfStoppedMock.mockResolvedValue(undefined);
    const { POST } = await loadStart();
    const res = await POST(makeReq({ url: "http://localhost/api/admin/server/start" }));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(startIfStoppedMock).toHaveBeenCalledOnce();
    expect(auditMock).toHaveBeenCalledOnce();
    expect(auditMock.mock.calls[0]![1]).toBe("LIFECYCLE_START");
  });

  it("maps ProxyUnreachableError to 503", async () => {
    sessionMock.mockResolvedValue(ADMIN);
    startIfStoppedMock.mockRejectedValue(new ProxyUnreachableError());
    const { POST } = await loadStart();
    const res = await POST(makeReq({ url: "http://localhost/api/admin/server/start" }));
    expect(res.status).toBe(503);
  });
});

describe("POST /api/admin/server/stop", () => {
  it("rejects VIEWER with 403", async () => {
    sessionMock.mockResolvedValue(VIEWER);
    const { POST } = await loadStop();
    const res = await POST(makeReq({ url: "http://localhost/api/admin/server/stop" }));
    expect(res.status).toBe(403);
  });

  it("allows ADMIN and audits as LIFECYCLE_STOP", async () => {
    sessionMock.mockResolvedValue(ADMIN);
    gracefulStopMock.mockResolvedValue(undefined);
    const { POST } = await loadStop();
    const res = await POST(makeReq({ url: "http://localhost/api/admin/server/stop" }));
    expect(res.status).toBe(200);
    expect(gracefulStopMock).toHaveBeenCalledWith(30);
    expect(auditMock.mock.calls[0]![1]).toBe("LIFECYCLE_STOP");
  });
});

describe("POST /api/admin/server/restart", () => {
  it("rejects VIEWER with 403", async () => {
    sessionMock.mockResolvedValue(VIEWER);
    const { POST } = await loadRestart();
    const res = await POST(makeReq({ url: "http://localhost/api/admin/server/restart" }));
    expect(res.status).toBe(403);
  });

  it("returns 409 on concurrent LifecycleBusyError", async () => {
    sessionMock.mockResolvedValue(ADMIN);
    gracefulRestartMock.mockRejectedValue(new LifecycleBusyError());
    const { POST } = await loadRestart();
    const res = await POST(makeReq({ url: "http://localhost/api/admin/server/restart" }));
    expect(res.status).toBe(409);
    const j = await res.json();
    expect(j.code).toBe("lifecycle-busy");
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("returns 503 on proxy-unreachable", async () => {
    sessionMock.mockResolvedValue(ADMIN);
    gracefulRestartMock.mockRejectedValue(new ProxyUnreachableError());
    const { POST } = await loadRestart();
    const res = await POST(makeReq({ url: "http://localhost/api/admin/server/restart" }));
    expect(res.status).toBe(503);
  });

  it("allows ADMIN and audits as LIFECYCLE_RESTART", async () => {
    sessionMock.mockResolvedValue(ADMIN);
    gracefulRestartMock.mockResolvedValue(undefined);
    const { POST } = await loadRestart();
    const res = await POST(makeReq({ url: "http://localhost/api/admin/server/restart" }));
    expect(res.status).toBe(200);
    expect(gracefulRestartMock).toHaveBeenCalledWith(30);
    expect(auditMock.mock.calls[0]![1]).toBe("LIFECYCLE_RESTART");
  });
});

describe("POST /api/admin/server/force-stop", () => {
  it("rejects ADMIN with 403 (OWNER-only)", async () => {
    sessionMock.mockResolvedValue(ADMIN);
    const { POST } = await loadForceStop();
    const res = await POST(
      makeReq({
        url: "http://localhost/api/admin/server/force-stop",
        body: { confirm: "FORCE-STOP" },
      }),
    );
    expect(res.status).toBe(403);
    expect(forceStopMock).not.toHaveBeenCalled();
  });

  it("rejects OWNER with wrong confirm string (400)", async () => {
    sessionMock.mockResolvedValue(OWNER);
    const { POST } = await loadForceStop();
    const res = await POST(
      makeReq({
        url: "http://localhost/api/admin/server/force-stop",
        body: { confirm: "force-stop" }, // wrong case
      }),
    );
    expect(res.status).toBe(400);
    const j = await res.json();
    expect(j.code).toBe("bad-confirm");
    expect(forceStopMock).not.toHaveBeenCalled();
  });

  it("rejects OWNER with missing body (400)", async () => {
    sessionMock.mockResolvedValue(OWNER);
    const { POST } = await loadForceStop();
    const res = await POST(
      makeReq({
        url: "http://localhost/api/admin/server/force-stop",
        body: {},
      }),
    );
    expect(res.status).toBe(400);
  });

  it("allows OWNER with exact FORCE-STOP confirm", async () => {
    sessionMock.mockResolvedValue(OWNER);
    forceStopMock.mockResolvedValue(undefined);
    const { POST } = await loadForceStop();
    const res = await POST(
      makeReq({
        url: "http://localhost/api/admin/server/force-stop",
        body: { confirm: "FORCE-STOP" },
      }),
    );
    expect(res.status).toBe(200);
    expect(forceStopMock).toHaveBeenCalledOnce();
    expect(auditMock.mock.calls[0]![1]).toBe("LIFECYCLE_FORCE_STOP");
  });
});

describe("POST /api/admin/server/abort", () => {
  it("rejects VIEWER with 403", async () => {
    sessionMock.mockResolvedValue(VIEWER);
    const { POST } = await loadAbort();
    const res = await POST(makeReq({ url: "http://localhost/api/admin/server/abort" }));
    expect(res.status).toBe(403);
    expect(abortCurrentMock).not.toHaveBeenCalled();
  });

  it("returns aborted=false when phase was already idle", async () => {
    sessionMock.mockResolvedValue(ADMIN);
    getPhaseMock.mockReturnValue("idle");
    const { POST } = await loadAbort();
    const res = await POST(makeReq({ url: "http://localhost/api/admin/server/abort" }));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.aborted).toBe(false);
    expect(abortCurrentMock).toHaveBeenCalledOnce();
    expect(auditMock.mock.calls[0]![1]).toBe("LIFECYCLE_ABORT");
  });

  it("returns aborted=true when mid-lifecycle", async () => {
    sessionMock.mockResolvedValue(ADMIN);
    getPhaseMock.mockReturnValue("warning");
    const { POST } = await loadAbort();
    const res = await POST(makeReq({ url: "http://localhost/api/admin/server/abort" }));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.aborted).toBe(true);
  });
});

describe("GET /api/admin/server/state", () => {
  it("rejects anonymous with 403", async () => {
    sessionMock.mockResolvedValue(null);
    const { GET } = await loadState();
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("returns the snapshot shape for VIEWER", async () => {
    sessionMock.mockResolvedValue(VIEWER);
    isProxyReachableMock.mockResolvedValue(true);
    inspectPzMock.mockResolvedValue({ running: true, status: "running" });
    rconPingMock.mockResolvedValue(true);
    getPhaseMock.mockReturnValue("idle");
    getDetailMock.mockReturnValue(undefined);
    const { GET } = await loadState();
    const res = await GET();
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(j.containerState).toBe("running");
    expect(j.rconOnline).toBe(true);
    expect(j.lifecyclePhase).toBe("idle");
    expect(j.proxyReachable).toBe(true);
  });

  it("reports containerState=unknown when proxy is down", async () => {
    sessionMock.mockResolvedValue(ADMIN);
    isProxyReachableMock.mockResolvedValue(false);
    getPhaseMock.mockReturnValue("idle");
    getDetailMock.mockReturnValue(undefined);
    const { GET } = await loadState();
    const res = await GET();
    const j = await res.json();
    expect(j.containerState).toBe("unknown");
    expect(j.proxyReachable).toBe(false);
    expect(j.rconOnline).toBe(false);
  });
});
