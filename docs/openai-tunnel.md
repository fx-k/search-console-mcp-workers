# Docker + OpenAI Tunnel 部署

这是 VPS 推荐方案，宿主机不需要安装 Node/npm。部署风格与 `mcp-esa` 保持一致：

- 一个 root-only `.env`
- 容器始终以非 root `node` 用户运行
- OpenAI Tunnel control-plane 可单独走 SOCKS5
- Bing / Google / PageSpeed / IndexNow 仍直接走 VPS 出口

## 架构

```text
ChatGPT
   │
   ▼
OpenAI Tunnel Service
   ▲
   │
VPS / Docker
├─ mcp-search-console-egress
│    └─ gost → SOCKS5_UPSTREAM → OpenAI
│
└─ mcp-search-console (USER node)
     ├─ tunnel-client ──────────→ CONTROL_PLANE_HTTP_PROXY
     │      │ stdio
     │      ▼
     └─ Search Console MCP
            ├─ Google ──────────→ Docker NAT → VPS IP
            ├─ Bing ────────────→ Docker NAT → VPS IP
            ├─ PageSpeed ───────→ Docker NAT → VPS IP
            └─ IndexNow ────────→ Docker NAT → VPS IP
```

## 1. Clone

```bash
cd ~/FXIT-dockerdata
git clone https://github.com/fx-k/search-console-mcp-workers.git mcp-search-console
cd mcp-search-console
```

## 2. 准备 .env

```bash
cp .env.example .env
chmod 600 .env
```

需要配置：

```dotenv
CONTROL_PLANE_TUNNEL_ID=tunnel_xxx
CONTROL_PLANE_API_KEY=sk-your-runtime-api-key

GOOGLE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'
BING_API_KEY=your-bing-api-key
INDEXNOW_KEY=your-public-indexnow-key

SOCKS5_UPSTREAM=socks5://user:password@proxy.example.com:1080

TUNNEL_CLIENT_VERSION=v0.0.14
MCP_IMAGE_TAG=0.5.1-tunnel-0.0.14
```

### Google JSON 为什么放 .env？

这是有意与 `mcp-esa` 对齐的单一路径设计。

Google Service Account JSON 先压成一行，再作为 `GOOGLE_SERVICE_ACCOUNT_JSON` 注入。这样：

- Dockerfile 可以一直 `USER node`
- 不需要 root entrypoint
- 不需要 copy secret 到 tmpfs 再降权
- 不需要处理 Compose 本地 secret bind mount 的 UID/GID 问题
- 不需要同时维护 JSON 文件 / Base64 / 环境变量多套配置

单机 root 管理 VPS 下，这与现有 `mcp-esa` 的信任边界一致。

> 注意：具备 Docker/root 权限的人可以查看容器环境变量。因此 `.env` 本身必须 `chmod 600`，并且不要把 Docker 管理权限给不受信任用户。

## 3. 从现有 Google JSON 生成单行值

如果已经有 `google-service-account.json`，可以用一次性 Node 容器生成单行 JSON：

```bash
GOOGLE_JSON="$(docker run --rm \
  -v "$PWD/google-service-account.json:/key.json:ro" \
  node:22-bookworm-slim \
  node -e 'const fs=require("fs");process.stdout.write(JSON.stringify(JSON.parse(fs.readFileSync("/key.json","utf8"))))'
)"

printf "GOOGLE_SERVICE_ACCOUNT_JSON='%s'\n" "$GOOGLE_JSON" >> .env
unset GOOGLE_JSON
```

确认只检查字段名，不打印值：

```bash
grep -q '^GOOGLE_SERVICE_ACCOUNT_JSON=' .env && echo "Google JSON configured"
```

## 4. Build & start

```bash
docker compose config --quiet
docker compose pull egress-proxy
docker compose build --pull mcp-search-console
docker compose up -d
```

检查：

```bash
docker compose ps
docker compose logs --tail=100 mcp-search-console
```

## 5. Health

```bash
docker exec mcp-search-console curl -fsS http://127.0.0.1:8080/healthz
echo

docker exec mcp-search-console curl -fsS http://127.0.0.1:8080/readyz
echo
```

进一步诊断：

```bash
docker exec mcp-search-console curl -fsS http://127.0.0.1:8080/health/mcp
echo
```

## 6. 验证分流出口

宿主机：

```bash
curl -4 -sS https://api.ipify.org
echo
```

MCP 容器：

```bash
docker exec mcp-search-console curl -4 -sS https://api.ipify.org
echo
```

两者应一致，说明 MCP 业务请求走 VPS 自己的公网 IP。

然后验证 Bing quota：

```bash
docker exec mcp-search-console sh -lc '
  curl -4 -sS -G "https://ssl.bing.com/webmaster/api.svc/json/GetUrlSubmissionQuota" \
    --data-urlencode "apikey=$BING_API_KEY" \
    --data-urlencode "siteUrl=https://keke.su/"
'
```

而 OpenAI Tunnel control-plane 只通过：

```text
CONTROL_PLANE_HTTP_PROXY=http://egress-proxy:18080
```

走 SOCKS5。

项目不会设置全局：

```text
HTTP_PROXY
HTTPS_PROXY
ALL_PROXY
MCP_HTTP_PROXY
```

所以 stdio child 的 Bing / Google 请求不会跟着进入 SOCKS5。

## 7. 更新

```bash
cd ~/FXIT-dockerdata/mcp-search-console
git pull --ff-only
docker compose build --pull
docker compose up -d
```

## 8. 停止

```bash
docker compose stop
```

删除容器和 Compose network：

```bash
docker compose down
```

不会删除 `.env` 或 Git 仓库。

## 安全设置

默认：

```text
USER node
read_only: true
cap_drop: ALL
no-new-privileges
tmpfs /tmp
pids_limit
memory limit
log rotation
.env chmod 600
```

这种设计刻意避免为了读取 root-owned Compose secret 而让主进程以 root 启动。

## OpenAI 官方资料

- https://github.com/openai/tunnel-client
- https://github.com/openai/tunnel-client/blob/master/docs/deployment/docker.md
- https://github.com/openai/tunnel-client/blob/master/docs/connectors.md
- https://github.com/openai/tunnel-client/blob/master/docs/health.md
