# syntax=docker/dockerfile:1.10
# Public Scolo runtime. Build secrets are mounted, never stored in an image layer.
FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.2 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.2 --activate
ENV NEXT_TELEMETRY_DISABLED=1
ENV SCOLO_WALLET_MODE=scolo
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN --mount=type=secret,id=CLERK_SECRET_KEY,env=CLERK_SECRET_KEY,required=true \
    --mount=type=secret,id=DATABASE_AUTH_TOKEN,env=DATABASE_AUTH_TOKEN \
    --mount=type=secret,id=SCOLO_ENVIRONMENT,env=SCOLO_ENVIRONMENT \
    --mount=type=secret,id=SCOLO_WALLET_MODE,env=SCOLO_WALLET_MODE \
    --mount=type=secret,id=NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,env=NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,required=true \
    --mount=type=secret,id=APP_URL,env=APP_URL,required=true \
    --mount=type=secret,id=DATABASE_URL,env=DATABASE_URL,required=true \
    --mount=type=secret,id=SOURCE_COMMIT,env=SOURCE_COMMIT,required=true \
    pnpm build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV SCOLO_WALLET_MODE=scolo
RUN addgroup -S nodejs && adduser -S nextjs -G nodejs
RUN mkdir -p /data && chown nextjs:nodejs /data
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
USER nextjs
EXPOSE 3000
CMD ["node_modules/.bin/next", "start", "--hostname", "0.0.0.0", "-p", "3000"]
