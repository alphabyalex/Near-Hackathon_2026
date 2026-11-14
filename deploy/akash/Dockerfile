# The Wardline backend for Akash: the API (port 8787) and the demo AI providers it calls on loopback (8791).
# Build from the repo root:  docker buildx build --platform linux/amd64 -f deploy/akash/Dockerfile -t <user>/wardline-api:<tag> .
# Kubernetes (Akash) injects <SERVICE>_PORT=tcp://... for every service, so a service named "api" sets API_PORT to a
# URL. The app reads WARDLINE_API_PORT first, which is set below and again in the SDL.
FROM node:22-bookworm-slim
# Fallback toolchain in case a native module (better-sqlite3) has no prebuilt binary for this platform.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g pnpm@12.16.1
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile --filter "@wardline/api..." --filter "@wardline/demo-provider..." \
 && pnpm --filter "@wardline/api..." --filter "@wardline/demo-provider..." build
COPY deploy/akash/start.sh deploy/akash/logserver.mjs /app/
RUN chmod +x /app/start.sh && useradd -m -u 10001 wardline && chown -R wardline /app
USER wardline
ENV NODE_ENV=development \
    WARDLINE_API_PORT=8787 \
    WARDLINE_BIND_PUBLIC=true \
    WARDLINE_TRUST_PROXY=true \
    WARDLINE_CHAIN_MODE=sim \
    WARDLINE_OWNER_PORT=8788
EXPOSE 8787
CMD ["/app/start.sh"]
