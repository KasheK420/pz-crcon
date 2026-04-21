"use client";

/**
 * Thin wrapper around `fetch` that reuses the Auth.js CSRF token for our
 * admin mutations. Auth.js v5 writes the CSRF cookie as `httpOnly: true`,
 * so `document.cookie` cannot read it. Instead we fetch the token from
 * the public `/api/auth/csrf` endpoint (which returns `{ csrfToken }`,
 * already stripped of the `|hmac` part) and cache it for the tab's
 * lifetime. The server-side validation in `lib/csrf/check.ts` compares
 * this header to the cookie's token half.
 */

let cachedToken: string | null = null;
let inflight: Promise<string | null> | null = null;

async function fetchCsrfToken(): Promise<string | null> {
  if (cachedToken) return cachedToken;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch("/api/auth/csrf", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!res.ok) return null;
      const j = (await res.json()) as { csrfToken?: string };
      cachedToken = j.csrfToken ?? null;
      return cachedToken;
    } catch {
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function _resetCsrfTokenCache(): void {
  cachedToken = null;
  inflight = null;
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
    const token = await fetchCsrfToken();
    if (token) headers.set("X-CSRF-Token", token);
    if (init.body !== undefined && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
  }
  const res = await fetch(input, {
    ...init,
    headers,
    credentials: "same-origin",
  });
  // If the server rejected us due to a stale/rotated token, drop the
  // cache once so the next mutation re-fetches a fresh one.
  if (mutating && res.status === 403) {
    cachedToken = null;
  }
  return res;
}
