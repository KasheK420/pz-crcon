# syntax=docker/dockerfile:1.7

# --- Builder ---
FROM node:22-alpine AS builder
RUN corepack enable
WORKDIR /app

# Install full deps (including dev) for build
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copy source and build
COPY . .
RUN pnpm db:generate
RUN pnpm build

# --- Runtime ---
FROM node:22-alpine AS runtime
RUN corepack enable && apk add --no-cache curl
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
