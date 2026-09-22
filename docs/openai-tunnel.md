# Docker + OpenAI Tunnel 部署

这是 VPS 推荐方案，宿主机不需要安装 Node/npm。

## 架构

```text
ChatGPT
   │
   ▼
OpenAI Tunnel Service
   ▲
   │ outbound HTTPS
   │
VPS / Docker
├─ mcp-search-console-egress
│    └─ gost → SOCKS5_UPSTREAM → OpenAI
│
└─ mcp-search-console
     ├─ tunnel-client ──────────→ egress-proxy → OpenAI control-plane
     │      │ stdio
     │      ▼
     └─ Search Console MCP
            ├─ Google ──────────→ Docker NAT → VPS IP
            ├─ Bing ────────────→ Docker NAT → VPS IP
            ├─ PageSpeed ───────→ Docker NAT → VPS IP
            └─ IndexNow ────────→ Docker NAT → VPS IP
```

这是**分流出口**：OpenAI Tunnel 控制面走 SOCKS5；MCP 自己调用搜索平台 API 时不走代理，所以 Bing 看到的仍是 VPS 公网出口 IP。

## 1. 创建目录

推荐与其它 MCP Docker 服务保持一致：

```bash
cd ~/FXIT-dockerdata
git clone https://github.com/fx-k/search-console-mcp-workers.git mcp-search-console
cd mcp-search-console
```

## 2. 准备配置目录

```bash
cp .env.example .env
mkdir -p secrets
chmod 700 secrets
```

最终目录：

```text
mcp-search-console/
├── Dockerfile
├── docker-compose.yml
├── .env
└── secrets/
    ├── google-service-account.json
    ├── bing-api-key
    └── openai-tunnel-api-key
```

`secrets/` 已被 Git 和 Docker build context 排除。

## 3. Google Service Account

把完整 JSON 保存为：

```text
secrets/google-service-account.json
```

建议：

```bash
chmod 600 secrets/google-service-account.json
```

## 4. Bing API Key

安全输入，避免进入 shell history：

```bash
read -rsp "Bing API Key: " BING_API_KEY
echo
printf '%s' "$BING_API_KEY" > secrets/bing-api-key
unset BING_API_KEY
chmod 600 secrets/bing-api-key
```

容器内部只读取：

```text
/run/secrets/bing_api_key
```

## 5. OpenAI Tunnel

在 OpenAI Platform 创建 / 选择 Tunnel，并取得：

- Tunnel ID
- Runtime API Key

将 Runtime API Key 写入：

```bash
read -rsp "OpenAI Tunnel Runtime API Key: " OPENAI_TUNNEL_API_KEY
echo
printf '%s' "$OPENAI_TUNNEL_API_KEY" > secrets/openai-tunnel-api-key
unset OPENAI_TUNNEL_API_KEY
chmod 600 secrets/openai-tunnel-api-key
```

然后编辑 `.env`：

```dotenv
SOCKS5_UPSTREAM=socks5://user:password@proxy.example.com:1080
CONTROL_PLANE_TUNNEL_ID=tunnel_xxx
INDEXNOW_KEY=
TUNNEL_CLIENT_VERSION=v0.0.14
MCP_IMAGE_TAG=0.5.0-tunnel-0.0.14
```

如果使用 IndexNow，把公开 key 填入 `INDEXNOW_KEY`。

## 6. Build

```bash
docker compose build
```

镜像由两部分组成：

```text
ghcr.io/openai/tunnel-client:v0.0.14
                +
node:22-bookworm-slim
                ↓
fxit/mcp-search-console:0.5.0-tunnel-0.0.14
```

tunnel-client 使用官方 release image 中的二进制；MCP 使用 Node 22。

## 7. 启动

```bash
docker compose up -d
```

检查：

```bash
docker compose ps
docker compose logs --tail=100
```

容器应为：

```text
mcp-search-console
```

## 8. Health

```bash
docker exec mcp-search-console curl -fsS http://127.0.0.1:8080/healthz
echo

docker exec mcp-search-console curl -fsS http://127.0.0.1:8080/readyz
echo
```

进一步诊断：

```bash
docker exec mcp-search-console curl -fsS 'http://127.0.0.1:8080/health?details=true'
echo

docker exec mcp-search-console curl -fsS http://127.0.0.1:8080/health/mcp
echo
```

OpenAI 官方说明：`/readyz` ready 只代表启动 readiness；stdio MCP 的真实 discovery 是否被观察到，可看 `/health/mcp`。

## 9. 为什么没有端口映射？

Compose 没有：

```yaml
ports:
  - ...
```

这是故意的。

Tunnel client 和 ChatGPT 的连接由容器主动向 OpenAI 建立，不需要把 MCP server 暴露到公网。

health endpoint 只在容器内部 loopback：

```text
127.0.0.1:8080
```

Docker healthcheck 直接从容器内部检查。

## 10. 分流代理为什么不会改变 Bing 出口？

`egress-proxy` 只服务于 OpenAI Tunnel control-plane。

Compose 对 tunnel-client 设置：

```text
CONTROL_PLANE_HTTP_PROXY=http://egress-proxy:18080
```

OpenAI 官方 tunnel-client 会将 control-plane 请求显式送入这个 HTTP proxy。stdio MCP binding 本身不使用 MCP HTTP proxy，而且本项目没有设置全局 `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY`。

因此：

```text
Tunnel → gost → SOCKS5 → OpenAI
MCP    → Docker NAT → VPS public IP → Bing/Google/PageSpeed
```

启动后先验证容器看到的直连出口：

```bash
docker exec mcp-search-console curl -4 -sS https://api.ipify.org
echo
```

它应与宿主机：

```bash
curl -4 -sS https://api.ipify.org
echo
```

一致。

然后可以在容器内直接验证 Bing，读取 Docker secret 而不把 Key 打印出来：

```bash
docker exec mcp-search-console sh -lc '
  KEY="$(cat /run/secrets/bing_api_key)"
  curl -4 -sS -G "https://ssl.bing.com/webmaster/api.svc/json/GetUrlSubmissionQuota" \
    --data-urlencode "apikey=$KEY" \
    --data-urlencode "siteUrl=https://keke.su/"
'
```

如果这里正常，而 tunnel-client 日志也显示已连接 OpenAI，就说明两条出口都按预期分流。

## 11. 更新

```bash
cd ~/FXIT-dockerdata/mcp-search-console
git pull --ff-only
docker compose build --pull
docker compose up -d
docker image prune -f
```

## 12. 停止 / 删除容器

只停止：

```bash
docker compose stop
```

删除容器和 Compose network：

```bash
docker compose down
```

不会删除：

- `.env`
- `secrets/`
- Git 仓库

如果要彻底退役，再手工删除这些文件。

## 安全设置

Compose 默认：

```text
read_only: true
cap_drop: ALL
no-new-privileges
tmpfs /tmp
pids_limit
memory limit
log rotation
Docker secrets
```

OpenAI Tunnel Runtime API Key、Bing API Key、Google Service Account 都不放进 `.env`。

## OpenAI 官方资料

- https://github.com/openai/tunnel-client
- https://github.com/openai/tunnel-client/blob/master/docs/deployment/docker.md
- https://github.com/openai/tunnel-client/blob/master/docs/connectors.md
- https://github.com/openai/tunnel-client/blob/master/docs/health.md
