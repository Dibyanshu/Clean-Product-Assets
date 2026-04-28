FROM node:20-bookworm-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable

WORKDIR /app

# Copy workspace manifests first for better layer caching.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY artifacts/api-server/package.json artifacts/api-server/package.json
COPY artifacts/legacy-modernization-ui/package.json artifacts/legacy-modernization-ui/package.json
COPY lib/api-zod/package.json lib/api-zod/package.json
COPY lib/db/package.json lib/db/package.json
COPY lib/integrations-openai-ai-server/package.json lib/integrations-openai-ai-server/package.json
COPY lib/integrations-openai-ai-react/package.json lib/integrations-openai-ai-react/package.json
COPY lib/api-client-react/package.json lib/api-client-react/package.json

RUN pnpm install --frozen-lockfile

FROM base AS build-backend
COPY . .
RUN pnpm --filter @workspace/api-server run build

FROM node:20-bookworm-slim AS backend
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY artifacts/api-server/package.json artifacts/api-server/package.json
COPY lib/api-zod/package.json lib/api-zod/package.json
COPY lib/db/package.json lib/db/package.json
COPY lib/integrations-openai-ai-server/package.json lib/integrations-openai-ai-server/package.json
COPY lib/integrations-openai-ai-react/package.json lib/integrations-openai-ai-react/package.json

RUN pnpm install --frozen-lockfile --prod

COPY --from=build-backend /app/artifacts/api-server/dist artifacts/api-server/dist

WORKDIR /app/artifacts/api-server

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "--enable-source-maps", "./dist/index.mjs"]

FROM base AS build-frontend
ARG PORT=21168
ARG BASE_PATH=/
ARG VITE_API_BASE_URL=
ENV PORT=$PORT
ENV BASE_PATH=$BASE_PATH
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
COPY . .
RUN pnpm --filter @workspace/legacy-modernization-ui run build

FROM nginx:1.27-alpine AS frontend
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build-frontend /app/artifacts/legacy-modernization-ui/dist/public /usr/share/nginx/html

EXPOSE 80
