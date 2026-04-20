/**
 * Unit test for server-side secret redaction in GET /api/admin/config/ini.
 *
 * We mock the session helper and the config reader so the route handler
 * runs end-to-end in-process without hitting the filesystem. Covers:
 *   - VIEWER: secrets returned as "__REDACTED__"
 *   - OWNER : secrets returned verbatim
 *   - secrets sub-route: OWNER-only, returns raw values
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const sessionMock = vi.fn();
const readServerIniMock = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  getSession: () => sessionMock(),
}));
vi.mock("@/lib/pz/config-reader", () => ({
  readServerIni: () => readServerIniMock(),
}));
vi.mock("@/lib/pz/writer", () => ({
  writeServerIni: vi.fn(),
}));
vi.mock("@/lib/server/audit", () => ({
  recordAudit: vi.fn(),
}));

async function loadRoute() {
  return import("@/app/api/admin/config/ini/route");
}

async function loadSecretsRoute() {
  return import("@/app/api/admin/config/ini/secrets/route");
}

const FAKE_INI = {
  ok: true,
  path: "/pz-data/Server/servertest.ini",
  prefix: "servertest",
  mtimeMs: 1_700_000_000_000,
  raw: "",
  parsed: {
    map: {},
    entries: [
      { key: "PublicName", value: "My Server", line: 1 },
      { key: "RCONPassword", value: "supersecret123", line: 2 },
      { key: "Password", value: "joinpass", line: 3 },
      { key: "DiscordToken", value: "DISCORD_TOKEN_xyz", line: 4 },
      { key: "MaxPlayers", value: "16", line: 5 },
    ],
  },
};

beforeEach(() => {
  sessionMock.mockReset();
  readServerIniMock.mockReset();
  vi.resetModules();
});

describe("GET /api/admin/config/ini — redaction", () => {
  it("redacts secrets for VIEWER role", async () => {
    sessionMock.mockResolvedValue({
      userId: "u1",
      discordId: "d1",
      role: "VIEWER",
    });
    readServerIniMock.mockResolvedValue(FAKE_INI);
    const { GET } = await loadRoute();
    const res = await GET();
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.ok).toBe(true);
    const byKey = Object.fromEntries(
      (j.entries as { key: string; value: string; redacted?: boolean }[]).map(
        (e) => [e.key, e],
      ),
    );
    expect(byKey.RCONPassword.value).toBe("__REDACTED__");
    expect(byKey.RCONPassword.redacted).toBe(true);
    expect(byKey.Password.value).toBe("__REDACTED__");
    expect(byKey.DiscordToken.value).toBe("__REDACTED__");
    // Non-secret keys still exposed
    expect(byKey.PublicName.value).toBe("My Server");
    expect(byKey.MaxPlayers.value).toBe("16");
    // Raw response body must not contain the real password anywhere.
    const asText = JSON.stringify(j);
    expect(asText).not.toContain("supersecret123");
    expect(asText).not.toContain("joinpass");
    expect(asText).not.toContain("DISCORD_TOKEN_xyz");
  });

  it("returns secrets verbatim for OWNER role", async () => {
    sessionMock.mockResolvedValue({
      userId: "u1",
      discordId: "d1",
      role: "OWNER",
    });
    readServerIniMock.mockResolvedValue(FAKE_INI);
    const { GET } = await loadRoute();
    const res = await GET();
    const j = await res.json();
    expect(res.status).toBe(200);
    const byKey = Object.fromEntries(
      (j.entries as { key: string; value: string }[]).map((e) => [e.key, e]),
    );
    expect(byKey.RCONPassword.value).toBe("supersecret123");
    expect(byKey.Password.value).toBe("joinpass");
  });

  it("returns 401 for unauthenticated GET", async () => {
    sessionMock.mockResolvedValue(null);
    const { GET } = await loadRoute();
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns 503 when config-reader fails", async () => {
    sessionMock.mockResolvedValue({
      userId: "u1",
      discordId: "d1",
      role: "OWNER",
    });
    readServerIniMock.mockResolvedValue({
      ok: false,
      prefix: "servertest",
      path: "/pz-data/Server/servertest.ini",
      error: "ENOENT",
    });
    const { GET } = await loadRoute();
    const res = await GET();
    expect(res.status).toBe(503);
  });
});

describe("GET /api/admin/config/ini/secrets — OWNER-only", () => {
  it("rejects non-OWNER roles with 401", async () => {
    sessionMock.mockResolvedValue({
      userId: "u1",
      discordId: "d1",
      role: "ADMIN",
    });
    const { GET } = await loadSecretsRoute();
    const res = await GET();
    expect(res.status).toBe(401);
    expect(readServerIniMock).not.toHaveBeenCalled();
  });

  it("returns only secret-flagged keys for OWNER", async () => {
    sessionMock.mockResolvedValue({
      userId: "u1",
      discordId: "d1",
      role: "OWNER",
    });
    readServerIniMock.mockResolvedValue(FAKE_INI);
    const { GET } = await loadSecretsRoute();
    const res = await GET();
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.secrets).toEqual({
      RCONPassword: "supersecret123",
      Password: "joinpass",
      DiscordToken: "DISCORD_TOKEN_xyz",
    });
    expect(Object.keys(j.secrets)).not.toContain("PublicName");
  });
});
