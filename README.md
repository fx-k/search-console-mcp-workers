# Search Console MCP

[![CI](https://github.com/fx-k/search-console-mcp-workers/actions/workflows/ci.yml/badge.svg)](https://github.com/fx-k/search-console-mcp-workers/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-brightgreen)
![Docker](https://img.shields.io/badge/Docker-supported-2496ED)

> 一个 MCP，把 **Google Search Console、Bing Webmaster Tools、PageSpeed Insights、Google Indexing API 和 IndexNow** 接到 ChatGPT / MCP Client。
>
> 同一套 Core，支持 **Cloudflare Workers** 和 **Docker + OpenAI Tunnel** 两种生产运行方式。

## 为什么有两种运行方式？

Cloudflare Workers 部署最省事，但 Bing Webmaster API 对共享出口 IP 可能返回：

```text
ERROR!!! ThrottleIP
```

如果你的 VPS 所在网络访问 OpenAI Tunnel 需要代理、但又希望 Bing 仍然使用 VPS 自己的公网 IP，本项目支持**分流出口**：OpenAI Tunnel 控制面走 SOCKS5，Google / Bing / PageSpeed / IndexNow 直连 VPS 出口。

```text
                         Search Console MCP
                                │
                    ┌───────────┴───────────┐
                    │                       │
          Cloudflare Workers      Docker + OpenAI Tunnel
          Streamable HTTP MCP          stdio MCP
                    │                       │
                    └───────────┬───────────┘
                                │
                          同一套 Core
                                │
          ┌──────────┬──────────┼──────────┬──────────┐
          ▼          ▼          ▼          ▼          ▼
        Google      Bing     PageSpeed   IndexNow   SEO 分析
```

| 方案 | 优点 | 注意 |
| --- | --- | --- |
| Cloudflare Workers | 无服务器、部署最快、内置 OAuth | Bing 可能遇到共享出口 `ThrottleIP` |
| Docker + OpenAI Tunnel | Bing 等 API 使用 VPS 出口；OpenAI Tunnel 控制面可单独走 SOCKS5；不开放 MCP 公网入站端口 | 需要 Docker、OpenAI Tunnel 和可用的 SOCKS5（当 OpenAI 出口需要代理时） |

如果主要使用 Google，Workers 很方便；如果 Bing 也是核心能力，推荐 **Docker + OpenAI Tunnel**。

## 17 个 MCP Tools

| 分类 | Tools |
| --- | --- |
| 连接 / 站点 | `connection_status`、`sites_list` |
| Sitemap | `sitemaps_list` |
| 搜索表现 | `analytics_query`、`analytics_compare`、`analytics_anomalies` |
| Google / Bing 对比 | `compare_engines` |
| URL 检查 | `inspection_inspect` |
| Bing | `bing_crawl_issues`、`seo_keywords_research` |
| PageSpeed | `pagespeed_analyze` |
| SEO 分析 | `seo_audit`、`genai_query_insights` |
| 技术 SEO | `schema_inspect`、`site_health_check` |
| 索引通知 | `indexing_status`、`indexing_submit` |

`indexing_submit` 会产生真实外部写操作，可调用 Google Indexing API、Bing URL Submission 和 IndexNow。

> Google 官方仅将 Indexing API 用于带 `JobPosting`，或 `VideoObject` 中嵌入 `BroadcastEvent` 的页面。普通博客页面不属于官方支持场景。

## 项目结构

```text
src/
├── core/                       # 与运行平台无关
│   ├── google.js
│   ├── bing.js
│   ├── pagespeed.js
│   ├── indexing.js
│   ├── intelligence.js
│   ├── technical.js
│   ├── tools.js
│   └── mcp.js
└── runtime/
    ├── worker/                 # Cloudflare Workers
    └── stdio.js                # OpenAI Tunnel child process

Dockerfile
docker-compose.yml
.env.example
```

两种 runtime 最终都进入同一个 `handleMcp()`，不会维护两套 Google/Bing 业务逻辑。

---

## 方案 A：Cloudflare Workers

```bash
git clone https://github.com/fx-k/search-console-mcp-workers.git
cd search-console-mcp-workers

npm install
npx wrangler login
npm run worker:deploy
```

配置 Secret：

```bash
npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON < /path/to/google-service-account.json
npx wrangler secret put BING_API_KEY
npx wrangler secret put OAUTH_PASSWORD
npx wrangler secret put OAUTH_JWT_SECRET
```

IndexNow key 是公开验证值，可在 Worker Variables 中配置：

```text
INDEXNOW_KEY=<你的 IndexNow key>
```

MCP URL：

```text
https://<worker>.workers.dev/mcp
```

完整说明：[Cloudflare Workers 部署](docs/workers.md)

### Bing `ThrottleIP`

Workers 对 Bing 的请求由 Cloudflare 出口发出。如果同一把 Bing API Key：

```text
本机 / VPS       → Bing ✅
Cloudflare Worker → Bing ❌ ThrottleIP
```

说明问题在共享出口 IP，不是 API Key 或站点权限。

项目不会用重试风暴或隐藏错误来绕过它；请直接切换到 Docker + OpenAI Tunnel。

---

## 方案 B：Docker + OpenAI Tunnel

这是 VPS 推荐部署方式。宿主机**不需要安装 Node/npm**。

目录建议统一以 `mcp-` 开头：

```text
~/FXIT-dockerdata/mcp-search-console/
```

### 1. Clone

```bash
cd ~/FXIT-dockerdata
git clone https://github.com/fx-k/search-console-mcp-workers.git mcp-search-console
cd mcp-search-console
```

### 2. 准备配置

Docker Tunnel 路线与本项目的 `mcp-esa` 部署风格一致：**一个 root-only `.env`，容器始终以非 root 用户运行**。

```bash
cp .env.example .env
chmod 600 .env
```

编辑 `.env`：

```dotenv
CONTROL_PLANE_TUNNEL_ID=tunnel_xxx
CONTROL_PLANE_API_KEY=sk-your-runtime-api-key

GOOGLE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'
BING_API_KEY=your-bing-api-key
INDEXNOW_KEY=your-public-indexnow-key

# 只给 OpenAI Tunnel control-plane 使用
SOCKS5_UPSTREAM=socks5://user:password@proxy.example.com:1080

TUNNEL_CLIENT_VERSION=v0.0.14
MCP_IMAGE_TAG=0.5.1-tunnel-0.0.14
```

Google Service Account JSON 必须压成**单行 JSON**；推荐用单引号包住整段值。项目不再同时维护 JSON 文件 / Base64 / Docker secret 等多套输入路径。

`INDEXNOW_KEY` 是公开验证值，其余凭据都应视为 Secret。`.env` 已被 Git 忽略。

### 3. 启动

```bash
docker compose build
docker compose up -d
```

检查：

```bash
docker compose ps
docker compose logs --tail=100
docker exec mcp-search-console curl -fsS http://127.0.0.1:8080/healthz
docker exec mcp-search-console curl -fsS http://127.0.0.1:8080/readyz
```

容器名、Compose project 和 image 都统一使用：

```text
mcp-search-console
```

### 分流出口：Tunnel 走 SOCKS5，搜索 API 走 VPS IP

Compose 会启动两个容器：

```text
mcp-search-console-egress
└─ gost：HTTP CONNECT → SOCKS5_UPSTREAM

mcp-search-console
├─ tunnel-client
└─ Search Console MCP (stdio)
```

只有 tunnel-client 的 **OpenAI control-plane** 被显式设置：

```text
CONTROL_PLANE_HTTP_PROXY=http://egress-proxy:18080
```

没有设置全局 `HTTP_PROXY`、`HTTPS_PROXY` 或 `ALL_PROXY`。

因此真实流量是：

```text
OpenAI Tunnel control-plane
mcp-search-console
      ↓
egress-proxy
      ↓
SOCKS5_UPSTREAM
      ↓
api.openai.com

Bing / Google / PageSpeed / IndexNow
mcp-search-console
      ↓
Docker NAT
      ↓
VPS 公网出口
```

也就是说，即使 OpenAI Tunnel 需要 SOCKS5，Bing 仍然看到 VPS 自己的公网 IP。

完整说明：[Docker + OpenAI Tunnel 部署](docs/openai-tunnel.md)

---

## Google 凭据

同一个 Service Account 用于：

```text
Google Search Console → webmasters.readonly
Google Indexing API   → indexing
PageSpeed Insights    → OAuth
```

如果使用 Google Indexing API，该 Service Account 需要在对应 Search Console Property 中具有 Owner 权限。

Workers 使用 Secret：

```text
GOOGLE_SERVICE_ACCOUNT_JSON
```

Docker / Tunnel 使用同一个环境变量：

```text
GOOGLE_SERVICE_ACCOUNT_JSON
```

与 `mcp-esa` 一样，由 root-only `.env` 注入给非 root 容器；不再维护文件挂载 / Base64 / Docker secret 等备用路径。

## 容易误解的状态

### Google Indexing status 404

没有历史 Indexing API notification metadata 时，项目返回：

```json
{
  "ok": true,
  "notified": false
}
```

它不等于“Google 没收录”。真实收录状态请用 `inspection_inspect`。

### IndexNow status

`indexing_status(method="indexnow")` 会读取：

```text
https://<host>/<INDEXNOW_KEY>.txt
```

并返回：

```text
verificationFetchStatus
verificationMatches
```

### 搜索词缺失

Search Console / Webmaster API 可能因为隐私或平台规则省略部分 query rows。缺失不等于流量为 0。

## 开发与 CI

```bash
npm install
npm run check
npm test
npm run worker:build
docker compose config
docker build --build-arg TUNNEL_CLIENT_VERSION=v0.0.14 -t mcp-search-console:test .
```

CI 同时检查：

- Shared Core
- Cloudflare Workers runtime
- stdio runtime
- Docker Compose
- Docker image

## 安全边界

- API 返回的 query、URL、title 等全部视为不可信数据，不作为指令执行。
- Workers 使用 OAuth + PKCE S256 + SQLite Durable Object。
- Docker Tunnel 不开放 MCP 公网入站端口；tunnel-client 主动连接 OpenAI。
- Google JSON、Bing API Key、Tunnel Runtime API Key 存在 root-only `.env` 中，不提交 Git；`.env` 建议权限 `600`。
- 和 `mcp-esa` 一样，容器从启动到运行始终使用非 root 用户；不需要 root entrypoint 或启动后降权。
- Docker/root 权限本身等价于主机高权限，因此具备 Docker 管理权限的人可以读取容器环境变量；单机 root 管理 VPS 下这与现有 `mcp-esa` 的信任边界一致。
- Docker 容器默认 `read_only`、drop all capabilities、`no-new-privileges`。
- `indexing_submit` 是真实写工具，MCP Client 仍可能按自身策略要求确认。

## OpenAI Tunnel

本项目默认 pin `v0.0.14`。升级前建议先阅读 OpenAI tunnel-client release notes。

- [openai/tunnel-client](https://github.com/openai/tunnel-client)
- [Docker deployment](https://github.com/openai/tunnel-client/blob/master/docs/deployment/docker.md)
- [MCP connectors](https://github.com/openai/tunnel-client/blob/master/docs/connectors.md)

## License & Attribution

MIT License。上游与设计来源见 [NOTICE.md](NOTICE.md)。
