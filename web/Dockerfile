# Kernel 3.10 is outside Node.js 22 glibc support. This image passed the
# private VM runtime probe; see deploy/README.md for the deployment limits.
FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS app

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV NOVEL_STANDALONE_BUILD=1
ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build?schema=public
ARG ADMIN_CONSOLE_URL=http://localhost:3001
ENV ADMIN_CONSOLE_URL=${ADMIN_CONSOLE_URL}
WORKDIR /app/web

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && \
    rm -rf /var/lib/apt/lists/* && corepack enable
COPY web/package.json web/pnpm-lock.yaml web/pnpm-workspace.yaml ./
COPY web/prisma ./prisma
COPY web/prisma-postgresql ./prisma-postgresql
COPY packages/contracts /app/packages/contracts
RUN pnpm install --frozen-lockfile --prod=false
RUN pnpm db:generate:postgres

COPY web .
RUN pnpm build
RUN mkdir -p .next/standalone/web/.next && \
    cp -r public .next/standalone/web/public && \
    cp -r .next/static .next/standalone/web/.next/static

ENV COREPACK_HOME=/app/.corepack
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV NOVEL_DATA_DIR=/app/data
RUN corepack prepare pnpm@11.1.1 --activate && \
    mkdir -p /app/data && chown -R node:node /app
USER node

EXPOSE 3000
CMD ["sh", "-c", "pnpm db:migrate:postgres && node .next/standalone/web/server.js"]
