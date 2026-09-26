# syntax=docker/dockerfile:1
ARG NODE_VERSION=24

# ---------- Build ----------
FROM node:${NODE_VERSION}-alpine AS builder

# Build tools are only needed here: argon2 falls back to compiling from source
# when no prebuilt binary matches the platform.
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Install dependencies first so the layer caches across source changes.
COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npm run build

# Drop dev dependencies from the runtime image.
RUN npm prune --omit=dev

# ---------- Runtime ----------
FROM node:${NODE_VERSION}-alpine AS runtime

# openssl is needed to load and validate the signing key at boot.
RUN apk add --no-cache openssl tini && \
    addgroup -S app && adduser -S app -G app

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY package.json ./
COPY docker-entrypoint.sh ./docker-entrypoint.sh

# The private key is written here at start-up from the LICENSE_PRIVATE_KEY_PEM
# secret. It is never baked into the image and never committed to git.
RUN mkdir -p /app/keys && \
    chmod +x /app/docker-entrypoint.sh && \
    chown -R app:app /app

USER app
EXPOSE 4000

# Migrations run in the Fly release command, not here, so a rolling deploy can
# never apply the same migration twice.
ENTRYPOINT ["/sbin/tini", "--", "/app/docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
