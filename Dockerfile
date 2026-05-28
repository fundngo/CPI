# --- Build stage ---
# Use Node 20 LTS so better-sqlite3 has prebuilt binaries.
# We still install python/make/g++ as a fallback in case the prebuild server
# is unreachable or a future bump invalidates the prebuilt binary.
FROM node:20-bookworm-slim AS build
WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Install deps (deterministic). Copy lockfile + package.json first to cache layer.
COPY package*.json ./
RUN npm ci

# Copy source and build (Vite client + esbuild server bundle into dist/)
COPY . .
RUN npm run build

# Drop dev deps for the runtime image
RUN npm prune --omit=dev


# --- Runtime stage ---
FROM node:20-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=5000 \
    DATABASE_PATH=/data/data.db

# Runtime libs only (no compilers needed).
# libfontconfig1 + libpixman are needed by @napi-rs/canvas (vision PDF rendering).
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
    ca-certificates \
    libfontconfig1 \
    libpixman-1-0 \
 && rm -rf /var/lib/apt/lists/*

# Bring over the production node_modules (includes better-sqlite3 native build)
# and the built artifacts.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package*.json ./

# /data is where the SQLite file lives.
# Persistent storage is provided by attaching a Railway Volume to this service
# in the Railway dashboard with mount path /data. Do NOT use the Docker VOLUME
# instruction — Railway's Dockerfile validator rejects it.
RUN mkdir -p /data

EXPOSE 5000

# Railway sets PORT; our server already reads it. Use the production build.
CMD ["node", "dist/index.cjs"]
