/**
 * HMAC verification for the Lua-mod webhook.
 *
 * Headers:
 *   X-Pz-Signature: sha256=<hex>
 *   X-Pz-Secret-Rev: current | next   (optional; defaults to current)
 *
 * Rotation model: while `WEBHOOK_HMAC_SECRET_NEXT` is set, either key
 * verifies. Operators flip by:
 *   1. Set `_NEXT` to the new key; Lua mod still uses the old key.
 *   2. Update the Lua mod config to send `Rev: next` with the new key.
 *   3. After the mod has flipped, promote `_NEXT` to `WEBHOOK_HMAC_SECRET`
 *      and clear `_NEXT`.
 *
 * Timing-safe compare everywhere; never log raw signatures.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { loadEnv } from "@/lib/env";

export type SecretRev = "current" | "next";

export interface VerifyInput {
  rawBody: string | Buffer;
  signatureHeader: string | null;
  revHeader: string | null;
}

export type VerifyOutcome =
  | { ok: true; rev: SecretRev }
  | {
      ok: false;
      reason: "missing-signature" | "malformed-signature" | "mismatch" | "no-secret-for-rev";
    };

function computeSig(body: string | Buffer, secret: string): Buffer {
  const h = createHmac("sha256", secret);
  h.update(typeof body === "string" ? Buffer.from(body) : body);
  return h.digest();
}

function parseSig(header: string): Buffer | null {
  // Accept `sha256=<hex>` or just `<hex>`.
  const payload = header.startsWith("sha256=") ? header.slice(7) : header;
  if (!/^[0-9a-fA-F]{64}$/.test(payload)) return null;
  return Buffer.from(payload, "hex");
}

function pickSecret(rev: SecretRev): string | null {
  const env = loadEnv();
  if (rev === "next") return env.WEBHOOK_HMAC_SECRET_NEXT ?? null;
  return env.WEBHOOK_HMAC_SECRET ?? null;
}

export function verifyHmac(input: VerifyInput): VerifyOutcome {
  if (!input.signatureHeader) return { ok: false, reason: "missing-signature" };
  const provided = parseSig(input.signatureHeader);
  if (!provided) return { ok: false, reason: "malformed-signature" };

  const rev: SecretRev =
    input.revHeader && input.revHeader.trim().toLowerCase() === "next"
      ? "next"
      : "current";
  const secret = pickSecret(rev);
  if (!secret) return { ok: false, reason: "no-secret-for-rev" };

  const expected = computeSig(input.rawBody, secret);
  if (expected.length !== provided.length) {
    return { ok: false, reason: "mismatch" };
  }
  if (!timingSafeEqual(expected, provided)) {
    return { ok: false, reason: "mismatch" };
  }
  return { ok: true, rev };
}

/**
 * Fallback auth: accept a raw shared-secret header match when the Lua
 * mod can't compute HMAC (PZ 42 `luanet` Java-interop limitation). The
 * secret travels over HTTPS (Cloudflare Tunnel → NPM → pz-crcon), so
 * confidentiality is the TLS layer's job. Replay protection is weaker
 * than HMAC (no body binding), but for a single-tenant panel with a
 * tightly controlled mod source this is acceptable as an interim.
 *
 * Accepts current OR next secret to keep rotation semantics.
 */
export function verifyBearerSecret(headerValue: string | null): VerifyOutcome {
  if (!headerValue) return { ok: false, reason: "missing-signature" };
  const provided = headerValue.trim();
  const env = loadEnv();
  for (const rev of ["current", "next"] as SecretRev[]) {
    const secret = rev === "next" ? env.WEBHOOK_HMAC_SECRET_NEXT : env.WEBHOOK_HMAC_SECRET;
    if (!secret) continue;
    if (secret.length === provided.length) {
      const a = Buffer.from(secret);
      const b = Buffer.from(provided);
      if (a.length === b.length && timingSafeEqual(a, b)) {
        return { ok: true, rev };
      }
    }
  }
  return { ok: false, reason: "mismatch" };
}

/**
 * Build the signature a signed request should carry. Helpful for the
 * smoke-test script and for local dev tools.
 */
export function signBody(body: string | Buffer, rev: SecretRev = "current"): string {
  const secret = pickSecret(rev);
  if (!secret) throw new Error(`no secret configured for rev=${rev}`);
  return `sha256=${computeSig(body, secret).toString("hex")}`;
}
