/**
 * Integration tests for PUT /api/admin/config/ini and /api/admin/config/sandbox.
 *
 * The routes share shape/wiring, so we exercise the gate chain (role → CSRF
 * → json parse → writer) for the sandbox path and spot-check ini for a
 * happy-path + mtime-mismatch. Session and writer are mocked so we don't
 * need a filesystem or a database.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const sessionMock = vi.fn();
const writeSandboxMock = vi.fn();
const writeIniMock = vi.fn();
const readSandboxMock = vi.fn();
const readIniMock = vi.fn();
const auditMock = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  getSession: () => sessionMock(),
}));
vi.mock("@/lib/pz/writer", () => ({
  writeSandboxVars: (...args: unknown[]) => writeSandboxMock(...args),
  writeServerIni: (...args: unknown[]) => writeIniMock(...args),
}));
vi.mock("@/lib/pz/config-reader", () => ({
  readSandboxVars: () => readSandboxMock(),
  readServerIni: () => readIniMock(),
}));
vi.mock("@/lib/server/audit", () => ({
  recordAudit: (...args: unknown[]) => auditMock(...args),
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

async function loadSandbox() {
  return import("@/app/api/admin/config/sandbox/route");
}
async function loadIni() {
  return import("@/app/api/admin/config/ini/route");
}

function makeReq(
  body: unknown,
  opts: {
    method?: "PUT" | "POST";
    csrfHeader?: string | null;
    csrfCookie?: string | null;
    url?: string;
  } = {},
): NextRequest {
  const {
    method = "PUT",
    csrfHeader = "tok-abc",
    csrfCookie = "tok-abc|sig",
    url = "http://localhost/api/admin/config/sandbox",
  } = opts;
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (csrfHeader) headers["x-csrf-token"] = csrfHeader;
  if (csrfCookie) {
    headers["cookie"] = `next-auth.csrf-token=${encodeURIComponent(csrfCookie)}`;
  }
  return new NextRequest(url, {
    method,
    headers,
    body: JSON.stringify(body),
  });
}

const OWNER_SESSION = { userId: "u1", discordId: "d1", role: "OWNER" };
const VIEWER_SESSION = { userId: "u2", discordId: "d2", role: "VIEWER" };

beforeEach(() => {
  sessionMock.mockReset();
  writeSandboxMock.mockReset();
  writeIniMock.mockReset();
  readSandboxMock.mockReset();
  readIniMock.mockReset();
  auditMock.mockReset();
  vi.resetModules();
});

describe("PUT /api/admin/config/sandbox", () => {
  it("rejects VIEWER with 403 and skips the writer", async () => {
    sessionMock.mockResolvedValue(VIEWER_SESSION);
    const { PUT } = await loadSandbox();
    const res = await PUT(
      makeReq({ clientMtimeMs: 1, patch: { "ZombieLore.Speed": 2 } }),
    );
    expect(res.status).toBe(403);
    expect(writeSandboxMock).not.toHaveBeenCalled();
  });

  it("rejects missing CSRF header with 403", async () => {
    sessionMock.mockResolvedValue(OWNER_SESSION);
    const { PUT } = await loadSandbox();
    const res = await PUT(
      makeReq(
        { clientMtimeMs: 1, patch: { "ZombieLore.Speed": 2 } },
        { csrfHeader: null },
      ),
    );
    expect(res.status).toBe(403);
    const j = await res.json();
    expect(j.code).toBe("csrf");
    expect(writeSandboxMock).not.toHaveBeenCalled();
  });

  it("rejects mtime mismatch with 409", async () => {
    sessionMock.mockResolvedValue(OWNER_SESSION);
    writeSandboxMock.mockResolvedValue({
      ok: false,
      code: "mtime-race",
      detail: "client mtime 1 != disk 2",
    });
    const { PUT } = await loadSandbox();
    const res = await PUT(
      makeReq({ clientMtimeMs: 1, patch: { "ZombieLore.Speed": 2 } }),
    );
    expect(res.status).toBe(409);
    const j = await res.json();
    expect(j.code).toBe("mtime-race");
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("returns 400 on descriptor validation failure", async () => {
    sessionMock.mockResolvedValue(OWNER_SESSION);
    writeSandboxMock.mockResolvedValue({
      ok: false,
      code: "validation",
      detail: "patch failed descriptor validation",
      errors: [{ path: "ZombieLore.Speed", code: "range", message: "too big" }],
    });
    const { PUT } = await loadSandbox();
    const res = await PUT(
      makeReq({ clientMtimeMs: 1, patch: { "ZombieLore.Speed": 99 } }),
    );
    expect(res.status).toBe(400);
    const j = await res.json();
    expect(j.code).toBe("validation");
  });

  it("returns 400 on bad JSON body schema", async () => {
    sessionMock.mockResolvedValue(OWNER_SESSION);
    const { PUT } = await loadSandbox();
    const res = await PUT(makeReq({ wrong: "shape" }));
    expect(res.status).toBe(400);
    expect(writeSandboxMock).not.toHaveBeenCalled();
  });

  it("returns 503 when config dir unreachable", async () => {
    sessionMock.mockResolvedValue(OWNER_SESSION);
    writeSandboxMock.mockResolvedValue({
      ok: false,
      code: "config-dir-unreachable",
      detail: "EACCES",
    });
    const { PUT } = await loadSandbox();
    const res = await PUT(
      makeReq({ clientMtimeMs: 1, patch: { "ZombieLore.Speed": 2 } }),
    );
    expect(res.status).toBe(503);
  });

  it("returns 200 with diff and requiresRestart: true on success", async () => {
    sessionMock.mockResolvedValue(OWNER_SESSION);
    writeSandboxMock.mockResolvedValue({
      ok: true,
      diff: [{ path: "ZombieLore.Speed", from: 3, to: 2 }],
      newMtimeMs: 1_700_000_001_000,
      backupPath: "/pz-data/Server/.backups/servertest_SandboxVars.lua.bak-x",
    });
    const { PUT } = await loadSandbox();
    const res = await PUT(
      makeReq({
        clientMtimeMs: 1_700_000_000_000,
        patch: { "ZombieLore.Speed": 2 },
      }),
    );
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(j.requiresRestart).toBe(true);
    expect(j.diff).toHaveLength(1);
    expect(auditMock).toHaveBeenCalledOnce();
    expect(auditMock.mock.calls[0]![1]).toBe("CONFIG_WRITE");
    expect((auditMock.mock.calls[0]![2] as { file: string }).file).toBe(
      "sandbox",
    );
  });
});

describe("PUT /api/admin/config/ini — spot checks", () => {
  it("rejects VIEWER with 403", async () => {
    sessionMock.mockResolvedValue(VIEWER_SESSION);
    const { PUT } = await loadIni();
    const res = await PUT(
      makeReq(
        { clientMtimeMs: 1, patch: { MaxPlayers: 16 } },
        { url: "http://localhost/api/admin/config/ini" },
      ),
    );
    expect(res.status).toBe(403);
    expect(writeIniMock).not.toHaveBeenCalled();
  });

  it("flags requiresRestart based on descriptors on success", async () => {
    sessionMock.mockResolvedValue(OWNER_SESSION);
    // MaxPlayers requiresRestart, PublicName does not.
    writeIniMock.mockResolvedValue({
      ok: true,
      diff: [
        { path: "PublicName", from: "old", to: "new" },
        { path: "MaxPlayers", from: 16, to: 24 },
      ],
      newMtimeMs: 1_700_000_001_000,
      backupPath: "/pz-data/Server/.backups/servertest.ini.bak-x",
    });
    const { PUT } = await loadIni();
    const res = await PUT(
      makeReq(
        { clientMtimeMs: 1, patch: { PublicName: "new", MaxPlayers: 24 } },
        { url: "http://localhost/api/admin/config/ini" },
      ),
    );
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.requiresRestart).toBe(true);
  });

  it("returns requiresRestart=false when no restart-flagged keys changed", async () => {
    sessionMock.mockResolvedValue(OWNER_SESSION);
    writeIniMock.mockResolvedValue({
      ok: true,
      diff: [{ path: "PublicName", from: "old", to: "new" }],
      newMtimeMs: 1_700_000_001_000,
      backupPath: "/pz-data/Server/.backups/servertest.ini.bak-x",
    });
    const { PUT } = await loadIni();
    const res = await PUT(
      makeReq(
        { clientMtimeMs: 1, patch: { PublicName: "new" } },
        { url: "http://localhost/api/admin/config/ini" },
      ),
    );
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.requiresRestart).toBe(false);
  });
});
