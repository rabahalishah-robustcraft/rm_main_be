# syntax=docker/dockerfile:1
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Prisma resolves env("DATABASE_URL") during generate; without it, generate can fail with
# "The \"path\" argument must be of type string. Received undefined". Runtime uses Compose's DATABASE_URL.
ENV DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build?schema=public"

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY prisma ./prisma/

RUN npm ci

COPY tsconfig.json ./
COPY src ./src/

RUN npx prisma generate && npm run build

FROM node:20-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY prisma ./prisma/

# Prisma CLI for `migrate deploy` in entrypoint; client is copied from builder (avoids a second
# `prisma generate` here, which can fail with CLI/client lockfile skew under --omit=dev).
RUN npm ci --omit=dev && npm install prisma@5.6.0

COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client

COPY --from=builder /app/dist ./dist

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
