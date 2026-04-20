/**
 * Integration test for /api/rcon/execute.
 *
 * Stubs the RCON client, the Prisma client, the WS publisher and the
 * session helper so we exercise the route handler end-to-end without
 * standing up the real server. Lives under `tests/integration` because
 * it imports the route module (a server-only file) and exercises real
 * request parsing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const sessionMock = vi.fn();
const rconMock = vi.fn();
const auditCreateMock = vi.fn();
const publishMock = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  requireRole: (min: string) => sessionMock(min),
}));
vi.mock("@/lib/rcon/client", () => ({
  rconExecute: (cmd: string) => rconMock(cmd),
}));
vi.mock("@/lib/db/client", () => ({
  prisma: {
    adminAction: {
      create: (args: unknown) => auditCreateMock(args),
    },
  },
}));
vi.mock("@/lib/ws/server", () => ({
  publish: (channel: string, data: unknown) => publishMock(channel, data),
}));

async function loadRoute() {
  const mod = await import("@/app/api/rcon/execute/route");
  return mod.POST;
}

function makeReq(body: unknown): Request {
  return new Request("http://localhost/api/rcon/execute", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/rcon/execute", () => {
  beforeEach(() => {
    sessionMock.mockReset();
    rconMock.mockReset();
    auditCreateMock.mockReset();
    publishMock.mockReset();
    vi.resetModules();
  });

  it("rejects unauthenticated callers with 401", async () => {
    sessionMock.mockRejectedValue(new Error("UNAUTHENTICATED"));
    const POST = await loadRoute();
    const res = await POST(makeReq({ command: "players" }));
    expect(res.status).toBe(401);
    expect(rconMock).not.toHaveBeenCalled();
  });

  it("rejects forbidden callers with 403", async () => {
    sessionMock.mockRejectedValue(new Error("FORBIDDEN"));
    const POST = await loadRoute();
    const res = await POST(makeReq({ command: "players" }));
    expect(res.status).toBe(403);
  });

  it("rejects bad payloads with 400", async () => {
    sessionMock.mockResolvedValue({
      userId: "u1",
      discordId: "d1",
      role: "MODERATOR",
    });
    const POST = await loadRoute();
    const res = await POST(makeReq({ wrongField: 1 }));
    expect(res.status).toBe(400);
  });

  it("blocks commands the role cannot run with 403 FORBIDDEN_COMMAND", async () => {
    sessionMock.mockResolvedValue({
      userId: "u1",
      discordId: "d1",
      role: "MODERATOR",
    });
    const POST = await loadRoute();
    const res = await POST(makeReq({ command: "quit" }));
    expect(res.status).toBe(403);
    const j = await res.json();
    expect(j.error).toBe("FORBIDDEN_COMMAND");
    expect(rconMock).not.toHaveBeenCalled();
  });

  it("executes, records an audit row, and publishes on success", async () => {
    sessionMock.mockResolvedValue({
      userId: "u1",
      discordId: "d1",
      role: "ADMIN",
    });
    rconMock.mockResolvedValue("Players connected (0):");
    auditCreateMock.mockResolvedValue({ id: "a1" });

    const POST = await loadRoute();
    const res = await POST(makeReq({ command: "players" }));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.output).toContain("Players connected");
    expect(rconMock).toHaveBeenCalledWith("players");
    expect(auditCreateMock).toHaveBeenCalledOnce();
    expect(publishMock).toHaveBeenCalledWith(
      "rcon:output",
      expect.objectContaining({ user: "d1", command: "players" })
    );
  });

  it("returns 502 if RCON call fails", async () => {
    sessionMock.mockResolvedValue({
      userId: "u1",
      discordId: "d1",
      role: "ADMIN",
    });
    rconMock.mockRejectedValue(new Error("connection refused"));

    const POST = await loadRoute();
    const res = await POST(makeReq({ command: "players" }));
    expect(res.status).toBe(502);
    expect(auditCreateMock).not.toHaveBeenCalled();
  });
});
