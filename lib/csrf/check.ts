import type { NextRequest } from "next/server";

/**
 * Double-submit CSRF check for admin mutations. Reads the token from the
 * Auth.js CSRF cookie (one of three possible names depending on scheme)
 * and compares it to the `X-CSRF-Token` request header.
 *
 * The token in the cookie is `token|hmac`; we strip the HMAC and compare
 * the token half only — the same shape that `/api/auth/csrf` returns and
 * that `csrfFetch` sends.
 *
 * Auth.js v5 (@auth/core ≥ 0.34) renamed the CSRF cookie from
 * `next-auth.csrf-token` to `authjs.csrf-token` (with the `__Host-`
 * prefix when `secure` cookies are used). We accept both families for
 * backwards compatibility with old browser sessions.
 */

const COOKIE_NAMES = [
  "__Host-authjs.csrf-token",
  "__Secure-authjs.csrf-token",
  "authjs.csrf-token",
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
