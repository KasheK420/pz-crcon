# syntax=docker/dockerfile:1.7

# --- Builder ---
FROM node:22-alpine AS builder
# Prisma needs OpenSSL on Alpine (defaults to looking for libssl 1.1.x)
RUN apk add --no-cache openssl libc6-compat
RUN corepack enable
WORKDIR /app

# Install full deps (including dev) for build
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copy source and build
COPY . .
RUN pnpm db:generate

# Next.js evaluates env at build time when route handlers import lib/env.ts.
# These dummy values satisfy validation; runtime uses real values from .env.
ENV NODE_ENV=production \
    APP_URL=http://localhost:3000 \
    NEXTAUTH_SECRET=build0123456789abcdef0123456789abcdef \
    DATABASE_URL=postgresql://x:y@localhost:5432/z \
    DISCORD_CLIENT_ID=build \
    DISCORD_CLIENT_SECRET=build \
    DISCORD_ADMIN_IDS=0 \
    RCON_HOST=127.0.0.1 \
    RCON_PORT=27015 \
    RCON_PASSWORD=build \
    WEBHOOK_HMAC_SECRET=build0123456789abcdef0123456789abcdef
RUN pnpm build

# --- Runtime ---
FROM node:22-alpine AS runtime
RUN apk add --no-cache curl openssl libc6-compat && corepack enable
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Install only prod deps + tsx (needed at runtime to execute server/ws.ts)
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
RUN pnpm add tsx@4.19.2

# Copy built Next.js standalone bundle + static + public + Prisma client + server entry + libs
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/server ./server
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/tsconfig.json ./tsconfig.json

# Non-root user
RUN addgroup -g 1001 nodejs && adduser -D -u 1001 -G nodejs pzcrcon
RUN chown -R pzcrcon:nodejs /app
USER pzcrcon

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:3000/api/status || exit 1

CMD ["pnpm", "start"]
