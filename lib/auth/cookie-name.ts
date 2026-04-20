import { loadEnv } from "@/lib/env";

export function getSessionCookieName(): string {
  const env = loadEnv();
  return env.APP_URL.startsWith("https://")
    ? "__Secure-authjs.session-token"
    : "authjs.session-token";
}
