FROM node:22-bookworm-slim AS build

WORKDIR /app

# better-sqlite3 falls back to compiling from source when no prebuild matches.
RUN apt-get update \
	&& apt-get install -y --no-install-recommends python3 make g++ \
	&& rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# Drop dev dependencies from the tree that gets copied into the runtime image.
RUN npm prune --omit=dev


FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update \
	&& apt-get install -y --no-install-recommends curl \
	&& rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

# Persisted KV database lives here; mount a volume to keep sessions and
# encrypted API keys across deployments.
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]

USER node

ENV PORT=3000
ENV KV_PATH=/data/hevy-mcp.db
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
	CMD curl -fsS http://127.0.0.1:3000/health || exit 1

CMD ["node", "dist/server.js"]
