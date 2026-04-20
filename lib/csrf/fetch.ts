"use client";

/**
 * Thin wrapper around `fetch` that reuses the Auth.js CSRF cookie for our
 * admin mutations. Auth.js writes the token under one of three cookie
 * names depending on deployment scheme; we look for whichever is present
 * and forward the raw token (the part before the `|hmac` separator) as
 * the `X-CSRF-Token` header on mutating requests.
 *
 * Server-side validation lives in `lib/csrf/check.ts`.
 */

const COOKIE_NAMES = [
  "next-auth.csrf-token",
  "__Secure-next-auth.csrf-token",
  "__Host-next-auth.csrf-token",
];

function getCsrfToken(): string | null {
  if (typeof document === "undefined") return null;
  const parts = document.cookie.split("; ");
  for (const raw of parts) {
    for (const name of COOKIE_NAMES) {
      if (raw.startsWith(`${name}=`)) {
        const decoded = decodeURIComponent(raw.slice(name.length + 1));
        // Auth.js stores `token|hmac` — we only send the token half.
        return decoded.split("|")[0] ?? null;
      }
    }
  }
  return null;
}

export async function csrfFetch(
  input: string | URL,
  init: RequestInit = {},
): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const mutating =
    method === "POST" ||
    method === "PUT" ||
    method === "PATCH" ||
    method === "DELETE";
  const headers = new Headers(init.headers);
  if (mutating) {
    const token = getCsrfToken();
    if (token) headers.set("X-CSRF-Token", token);
    if (init.body !== undefined && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
  }
  return fetch(input, { ...init, headers, credentials: "same-origin" });
}
