# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df

FROM ${NODE_IMAGE} AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@11.24.0 --activate

WORKDIR /app

FROM base AS development

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json biome.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/db/package.json packages/db/package.json

RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

COPY . .

FROM development AS build

RUN pnpm build

FROM build AS deploy

RUN pnpm --filter @chat-with-a-website/api deploy --prod /out/api \
  && cp -R apps/web/dist /out/api/public

FROM ${NODE_IMAGE} AS runtime

ENV NODE_ENV=production
ENV PORT=4311

WORKDIR /app

COPY --from=deploy --chown=root:root /out/api/ ./

USER node

EXPOSE 4311

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4311/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["sh", "-c", "node node_modules/@chat-with-a-website/db/dist/migrate.js && exec node dist/server.js"]
