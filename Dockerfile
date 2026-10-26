# Ferry API: an always-on Node service (the relayer and pollers run continuously).
FROM node:22-alpine

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.1.2 --activate

# Install only what the API needs, from the lockfile.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --prod --filter api...

COPY packages/shared packages/shared
COPY apps/api apps/api

ENV NODE_ENV=production
WORKDIR /app/apps/api
EXPOSE 3000
# Migrations are idempotent; apply them, then start.
CMD ["sh", "-c", "node --import tsx src/db/migrate.ts && node --import tsx src/index.ts"]
