# syntax=docker/dockerfile:1
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm install

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV AUTH_DATA_DIR=/app/data
# The TLS front generates the self-signed certificate with the openssl CLI.
RUN apk add --no-cache openssl
RUN mkdir -p /app/data
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
# Serves https and http on PORT with the standalone server behind it on loopback (see the script).
COPY --from=builder /app/scripts/serve-https.mjs ./serve-https.mjs
EXPOSE 3000
CMD ["node", "serve-https.mjs"]
