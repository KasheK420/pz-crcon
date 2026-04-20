import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkConfigAccess, getConfigAccessOk } from "@/lib/pz/access-check";

// Minimal env so getLogger()'s loadEnv() doesn't reject in a clean test
// shell. Real values are irrelevant — we only need the schema to pass.
const ENV_STUBS: Record<string, string> = {
  APP_URL: "http://localhost:3000",
  NEXTAUTH_SECRET: "x".repeat(32),
  DATABASE_URL: "postgresql://user:pw@host:5432/db",
  DISCORD_CLIENT_ID: "1",
  DISCORD_CLIENT_SECRET: "s",
  DISCORD_ADMIN_IDS: "1",
  RCON_HOST: "localhost",
  RCON_PORT: "27015",
  RCON_PASSWORD: "p",
  WEBHOOK_HMAC_SECRET: "y".repeat(32),
};

describe("access-check", () => {
  let dir: string;

  beforeEach(async () => {
    for (const [k, v] of Object.entries(ENV_STUBS)) vi.stubEnv(k, v);
    dir = await mkdtemp(join(tmpdir(), "pz-access-"));
    process.env.PZ_CONFIG_DIR = dir;
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    delete process.env.PZ_CONFIG_DIR;
    vi.unstubAllEnvs();
  });

  it("returns ok when dir is readable + writable", async () => {
    const res = await checkConfigAccess();
    expect(res.ok).toBe(true);
    expect(getConfigAccessOk()).toBe(true);
  });

  it("returns not-ok when dir does not exist", async () => {
    process.env.PZ_CONFIG_DIR = "/no/such/path/ever";
    const res = await checkConfigAccess();
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/ENOENT|does not exist/i);
    expect(getConfigAccessOk()).toBe(false);
  });
});
