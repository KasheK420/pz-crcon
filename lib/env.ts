import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  APP_URL: z.string().url(),
  NEXTAUTH_SECRET: z.string().min(32),
  DATABASE_URL: z.string().url(),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_CLIENT_SECRET: z.string().min(1),
  DISCORD_GUILD_ID: z.string().min(1),
  DISCORD_ADMIN_ROLE_ID: z.string().min(1),
  DISCORD_BOT_TOKEN: z.string().min(1),
  BOOTSTRAP_OWNER_DISCORD_ID: z.string().min(1),
  RCON_HOST: z.string().min(1),
  RCON_PORT: z.coerce.number().int().min(1).max(65535),
  RCON_PASSWORD: z.string().min(1),
  WEBHOOK_HMAC_SECRET: z.string().min(32),
  BACKUP_PATH: z.string().default("/var/lib/pz-crcon/backups"),
  BACKUP_RETENTION_DAYS: z.coerce.number().int().min(1).default(14),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  WS_HEARTBEAT_SEC: z.coerce.number().int().min(1).default(30),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/**
 * Lazy proxy. Any property access (`env.APP_URL`) triggers `loadEnv()` on
 * first use, so module imports never fail eagerly. Importers just write
 * `import { env } from "@/lib/env"` and treat it like a plain object.
 */
export const env: Env = new Proxy({} as Env, {
  get(_target, prop: string) {
    return loadEnv()[prop as keyof Env];
  },
});
