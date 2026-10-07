# Build from the monorepo-docs-agent root: docker build -f apps/api/Dockerfile .
FROM node:20-slim AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* .npmrc ./
COPY apps/api/package.json apps/api/
COPY packages/agent/package.json packages/agent/
COPY packages/shared/package.json packages/shared/
RUN corepack prepare pnpm@9.15.9 --activate && pnpm install --ignore-scripts --filter @markitdown/api...
COPY apps/api apps/api
COPY packages/agent packages/agent
RUN pnpm --filter @markitdown/api build && pnpm --filter @markitdown/api deploy --prod /srv

FROM node:20-slim
ENV NODE_ENV=production
WORKDIR /srv
COPY --from=build /srv .
EXPOSE 8000
CMD ["node", "dist/index.js"]
