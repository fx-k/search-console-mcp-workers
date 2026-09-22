# syntax=docker/dockerfile:1.7

ARG TUNNEL_CLIENT_VERSION=v0.0.14
FROM ghcr.io/openai/tunnel-client:${TUNNEL_CLIENT_VERSION} AS tunnel-client

FROM node:22-bookworm-slim

LABEL org.opencontainers.image.source="https://github.com/fx-k/search-console-mcp-workers"
LABEL org.opencontainers.image.description="mcp-search-console: Search Console MCP + OpenAI tunnel-client"

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl tini gosu \
    && rm -rf /var/lib/apt/lists/*

COPY --from=tunnel-client /usr/bin/tunnel-client /usr/bin/tunnel-client

WORKDIR /app
COPY package.json ./
COPY src ./src
COPY docker-entrypoint.sh /usr/local/bin/mcp-search-console-entrypoint

RUN chmod 0755 /usr/local/bin/mcp-search-console-entrypoint \
    && chown -R node:node /app

ENV NODE_ENV=production \
    HOME=/tmp \
    MCP_COMMAND="node /app/src/runtime/stdio.js" \
    HEALTH_LISTEN_ADDR=127.0.0.1:8080 \
    LOG_LEVEL=info \
    LOG_FORMAT=json

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/mcp-search-console-entrypoint"]
CMD []
