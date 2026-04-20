import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const baseEnv: Record<string, string> = {
  NODE_ENV: "production",
  APP_URL: "https://pz.majorluk.pl",
  NEXTAUTH_SECRET: "x".repeat(32),
  DATABASE_URL: "postgresql://user:pw@host:5432/db",
  DISCORD_CLIENT_ID: "1234567890",
  DISCORD_CLIENT_SECRET: "abc",
  DISCORD_GUILD_ID: "9876543210",
  DISCORD_ADMIN_ROLE_ID: "5555555555",
  DISCORD_BOT_TOKEN: "Bot.token.value",
  BOOTSTRAP_OWNER_DISCORD_ID: "286560250578862080",
  RCON_HOST: "85.215.222.81",
  RCON_PORT: "27015",
  RCON_PASSWORD: "secret",
  WEBHOOK_HMAC_SECRET: "y".repeat(32),
};

function stub(env: Record<string, string>) {
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
}

describe("loadEnv", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("parses a complete environment", async () => {
    stub(baseEnv);
    const { loadEnv } = await import("@/lib/env");
    const env = loadEnv();
    expect(env.APP_URL).toBe("https://pz.majorluk.pl");
    expect(env.RCON_PORT).toBe(27015);
    expect(env.BACKUP_RETENTION_DAYS).toBe(14);
  });

  it("throws when DATABASE_URL is missing", async () => {
    const { DATABASE_URL: _omit, ...rest } = baseEnv;
    stub(rest);
    const { loadEnv } = await import("@/lib/env");
    expect(() => loadEnv()).toThrow(/DATABASE_URL/);
  });

  it("rejects RCON_PORT outside 1-65535", async () => {
    stub({ ...baseEnv, RCON_PORT: "70000" });
    const { loadEnv } = await import("@/lib/env");
    expect(() => loadEnv()).toThrow(/RCON_PORT/);
  });

  it("requires NEXTAUTH_SECRET >= 32 chars", async () => {
    stub({ ...baseEnv, NEXTAUTH_SECRET: "short" });
    const { loadEnv } = await import("@/lib/env");
    expect(() => loadEnv()).toThrow(/NEXTAUTH_SECRET/);
  });

  it("env Proxy lazy-loads on first access", async () => {
    stub(baseEnv);
    const { env } = await import("@/lib/env");
    expect(env.APP_URL).toBe("https://pz.majorluk.pl");
  });

  it("env Proxy throws on access if validation fails", async () => {
    const { DATABASE_URL: _omit, ...rest } = baseEnv;
    stub(rest);
    const { env } = await import("@/lib/env");
    expect(() => env.APP_URL).toThrow(/DATABASE_URL/);
  });
});
