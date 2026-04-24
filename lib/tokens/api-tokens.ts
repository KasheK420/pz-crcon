/**
 * API-token management.
 *
 * Tokens are opaque random secrets presented in the `Authorization: Bearer`
 * header on non-browser API requests (the Lua mod webhook being the
 * main Phase 4 consumer). Each token has:
 *
 *   - prefix (first 8 chars, stored plaintext for UI display + lookup)
 *   - hash   (SHA-256 of the full token string, never decryptable)
 *   - scopes (string array — enforced at the route level)
 *
 * Flow:
 *   1. Panel generates token → shows to operator ONCE.
 *   2. Hash + prefix persisted in Prisma.
 *   3. API request arrives with `Bearer <token>` → prefix lookup →
 *      constant-time hash compare → scope check.
 *
 * This module intentionally does not implement the verify side yet —
 * Phase 4 (webhook endpoint) will pull it in. The create / list /
 * revoke surface is enough for the Settings UI today.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db/client";
import type { ApiToken } from "@prisma/client";

const PREFIX_LEN = 8;
const TOKEN_BYTES = 32; // 32 bytes → 64 hex chars

export interface TokenRow {
  id: string;
  userId: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}

function toRow(t: ApiToken): TokenRow {
  return {
    id: t.id,
    userId: t.userId,
    name: t.name,
    prefix: t.prefix,
    scopes: t.scopes,
    createdAt: t.createdAt.toISOString(),
    lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
    expiresAt: t.expiresAt?.toISOString() ?? null,
  };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface CreateInput {
  userId: string;
  name: string;
  scopes: string[];
  expiresAt?: Date | null;
}

export interface CreateResult {
  row: TokenRow;
  /** The full token. Shown to the operator ONCE; never stored plaintext. */
  token: string;
}

export async function createToken(input: CreateInput): Promise<CreateResult> {
  const raw = randomBytes(TOKEN_BYTES).toString("hex");
  const prefix = raw.slice(0, PREFIX_LEN);
  const hash = hashToken(raw);
  const created = await prisma.apiToken.create({
    data: {
      userId: input.userId,
      name: input.name,
      prefix,
      hash,
      scopes: input.scopes,
      expiresAt: input.expiresAt ?? null,
    },
  });
  return { row: toRow(created), token: raw };
}

export async function listTokens(userId?: string): Promise<TokenRow[]> {
  const rows = await prisma.apiToken.findMany({
    where: userId ? { userId } : undefined,
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toRow);
}

export async function revokeToken(id: string): Promise<boolean> {
  try {
    await prisma.apiToken.delete({ where: { id } });
    return true;
  } catch {
    return false;
  }
}

/**
 * Verify a bearer token. Returns the matching token row or null.
 * Uses the `prefix` for O(1) lookup, then timing-safe hash comparison
 * so a leaked prefix doesn't help brute-forcing.
 *
 * Not yet wired into any route — reserved for the Phase 4 Lua webhook.
 */
export async function verifyToken(
  raw: string,
): Promise<{ ok: true; row: ApiToken } | { ok: false; reason: string }> {
  if (!raw || raw.length < PREFIX_LEN + 8) {
    return { ok: false, reason: "token too short" };
  }
  const prefix = raw.slice(0, PREFIX_LEN);
  const candidate = await prisma.apiToken.findUnique({ where: { prefix } });
  if (!candidate) return { ok: false, reason: "unknown prefix" };
  if (candidate.expiresAt && candidate.expiresAt < new Date()) {
    return { ok: false, reason: "expired" };
  }
  const expected = Buffer.from(candidate.hash, "hex");
  const actual = Buffer.from(hashToken(raw), "hex");
  if (expected.length !== actual.length) {
    return { ok: false, reason: "hash length mismatch" };
  }
  if (!timingSafeEqual(expected, actual)) {
    return { ok: false, reason: "bad signature" };
  }
  // Fire-and-forget lastUsedAt update.
  prisma.apiToken
    .update({ where: { id: candidate.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});
  return { ok: true, row: candidate };
}
