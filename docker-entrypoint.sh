#!/bin/sh
set -eu

SECRET_DIR=/tmp/mcp-search-console-secrets

mkdir -p "$SECRET_DIR"
chmod 700 "$SECRET_DIR"

install -m 0400 -o node -g node /run/secrets/google_service_account "$SECRET_DIR/google_service_account"
install -m 0400 -o node -g node /run/secrets/bing_api_key "$SECRET_DIR/bing_api_key"
install -m 0400 -o node -g node /run/secrets/openai_tunnel_api_key "$SECRET_DIR/openai_tunnel_api_key"

export GOOGLE_SERVICE_ACCOUNT_FILE="$SECRET_DIR/google_service_account"
export BING_API_KEY_FILE="$SECRET_DIR/bing_api_key"

exec gosu node:node /usr/bin/tunnel-client run   --control-plane.api-key="file:$SECRET_DIR/openai_tunnel_api_key"   "$@"
