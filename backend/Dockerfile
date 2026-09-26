# syntax=docker/dockerfile:1
# ---------- Build ----------
FROM node:20-alpine AS builder

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
FROM node:20-alpine AS runtime

# openssl is needed to load and validate the signing key at boot.
RUN apk add --no-cache openssl tini && \
    addgroup -S app && adduser -S app -G app

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY package.json ./

# The private key is mounted at runtime from the host, never baked into the image.
RUN mkdir -p /app/keys && chown -R app:app /app

USER app
EXPOSE 4000

# Run migrations, then serve.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
