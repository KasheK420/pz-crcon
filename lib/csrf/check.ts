import type { NextRequest } from "next/server";

/**
 * Double-submit CSRF check for admin mutations. Reads the token from the
 * Auth.js cookie (one of three possible names depending on scheme) and
 * compares it to the `X-CSRF-Token` request header.
 *
 * The token in the cookie is `token|hmac`; we strip the HMAC and compare
 * the token half only — the same shape that `csrfFetch` sends.
 */

const COOKIE_NAMES = [
  "__Host-next-auth.csrf-token",
  "__Secure-next-auth.csrf-token",
  "next-auth.csrf-token",
];

export interface CsrfCheck {
  ok: boolean;
  reason?: "missing-header" | "missing-cookie" | "mismatch";
}

export function checkCsrf(req: NextRequest): CsrfCheck {
  const header = req.headers.get("x-csrf-token");
  if (!header) return { ok: false, reason: "missing-header" };
  const cookieName = COOKIE_NAMES.find((n) => req.cookies.get(n));
  if (!cookieName) return { ok: false, reason: "missing-cookie" };
  const cookieValue = req.cookies.get(cookieName)!.value;
  const tokenFromCookie = decodeURIComponent(cookieValue).split("|")[0];
  if (tokenFromCookie !== header) return { ok: false, reason: "mismatch" };
  return { ok: true };
}
