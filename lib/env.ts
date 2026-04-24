import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  APP_URL: z.string().url(),
  NEXTAUTH_SECRET: z.string().min(32),
  DATABASE_URL: z.string().url(),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_CLIENT_SECRET: z.string().min(1),
  // Comma-separated Discord user IDs of admins. First ID in the list
  // becomes OWNER on first login; rest become ADMIN. No bot / guild
  // required — OAuth proves identity, this list proves authorization.
  DISCORD_ADMIN_IDS: z.string().min(1),
  RCON_HOST: z.string().min(1),
  RCON_PORT: z.coerce.number().int().min(1).max(65535),
  RCON_PASSWORD: z.string().min(1),
  WEBHOOK_HMAC_SECRET: z.string().min(32),
  // Optional second secret — when set, requests signed with either key
  // verify. Used for zero-downtime HMAC rotation with the Lua mod.
  WEBHOOK_HMAC_SECRET_NEXT: z.string().min(32).optional(),
  BACKUP_PATH: z.string().default("/var/lib/pz-crcon/backups"),
  BACKUP_RETENTION_DAYS: z.coerce.number().int().min(1).default(14),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  WS_HEARTBEAT_SEC: z.coerce.number().int().min(1).default(30),

  // -----------------------------------------------------------------
  // Optional PZ / Docker / public overrides — all read via
  // `process.env` around the codebase. Declared here so the validator
  // catches typos (`PZ_SERVERPREFIX` instead of `PZ_SERVER_PREFIX` etc.)
  // even though they're all optional with sane defaults.
  // -----------------------------------------------------------------
  PZ_CONTAINER_NAME: z.string().default("pz-server"),
  PZ_CONFIG_DIR: z.string().default("/pz-data/Server"),
  PZ_SERVER_DIR: z.string().default("/pz-data/Server"),
  PZ_BACKUP_DIR: z.string().optional(),
  PZ_BACKUP_ROOT: z.string().optional(),
  PZ_DATA_DIR: z.string().optional(),
  PZ_SERVER_PREFIX: z.string().optional(),
  PZ_TILES_DIR: z.string().optional(),
  DOCKER_SOCKET_PATH: z.string().default("/var/run/docker.sock"),
  DOCKER_CONTROL_URL: z.string().url().optional(),
  NEXT_PUBLIC_PZ_TILE_URL: z.string().optional(),
  NEXT_PUBLIC_PZ_MIN_X: z.coerce.number().optional(),
  NEXT_PUBLIC_PZ_MIN_Y: z.coerce.number().optional(),
  NEXT_PUBLIC_PZ_MAX_X: z.coerce.number().optional(),
  NEXT_PUBLIC_PZ_MAX_Y: z.coerce.number().optional(),
  PUBLIC_SERVER_NAME: z.string().optional(),
  PUBLIC_SERVER_ADDRESS: z.string().optional(),
  PUBLIC_DISCORD_URL: z.string().optional(),
  PUBLIC_MAX_PLAYERS: z.coerce.number().int().min(1).optional(),
  PUBLIC_WORKSHOP_COLLECTION_URL: z.string().optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  MOD_WORKSHOP_IDS: z.string().optional(),

  // Phase 3/4 forward decls
  DISCORD_WEBHOOK_URL: z.string().url().optional(),
  INGEST_MAX_BODY_KB: z.coerce.number().int().positive().default(512),
  INGEST_STORE_CHAT: z
    .union([z.literal("true"), z.literal("false"), z.boolean()])
    .transform((v) => v === "true" || v === true)
    .default(false),
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
