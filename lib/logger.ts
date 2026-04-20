import pino, { type Logger } from "pino";
import { loadEnv } from "@/lib/env";

let _logger: Logger | null = null;

export function getLogger(): Logger {
  if (_logger) return _logger;
  const env = loadEnv();
  _logger = pino({
    level: env.LOG_LEVEL,
    transport:
      env.NODE_ENV === "development"
        ? {
            target: "pino-pretty",
            options: { colorize: true, translateTime: "HH:MM:ss.l" },
          }
        : undefined,
    base: { app: "pz-crcon" },
    redact: {
      paths: ["*.password", "*.rcon_password", "*.token", "*.secret"],
      censor: "[redacted]",
    },
  });
  return _logger;
}
