# Search Console MCP

[![CI](https://github.com/fx-k/search-console-mcp-workers/actions/workflows/ci.yml/badge.svg)](https://github.com/fx-k/search-console-mcp-workers/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-brightgreen)

> 一个 MCP，把 **Google Search Console、Bing Webmaster Tools、PageSpeed Insights、Google Indexing API 和 IndexNow** 接到 ChatGPT / MCP Client。
>
> 同一套核心能力，既可以一键部署到 **Cloudflare Workers**，也可以跑在自己的 **VPS + OpenAI Tunnel** 上。

## 为什么会有两个运行方式？

这个项目一开始只跑在 Cloudflare Workers：部署简单、不需要服务器，也很适合 Remote MCP。

但实际使用 Bing Webmaster API 时，Cloudflare Workers 的共享出口 IP **可能**遇到 Bing 返回 `ThrottleIP`。这不是 API Key 失效，而是 Bing 对当前出口 IP 做了限流。

因此项目现在采用「Core + Runtime」结构：

```text
                         Search Console MCP
                                │
                    ┌───────────┴───────────┐
                    │                       │
             Cloudflare Workers       VPS / OpenAI Tunnel
             Streamable HTTP MCP          stdio MCP
                    │                       │
                    └───────────┬───────────┘
                                │
                         同一套 Core Tools
                                │
          ┌──────────┬──────────┼──────────┬──────────┐
          ▼          ▼          ▼          ▼          ▼
        Google      Bing     PageSpeed   IndexNow   SEO 分析
```

**怎么选？**

| 方案 | 适合谁 | 优点 | 注意 |
| --- | --- | --- | --- |
| Cloudflare Workers | 想最快上线、不想养服务器 | 免费额度友好、Remote MCP、OAuth 自包含 | Bing 可能遇到共享出口 `ThrottleIP` |
| VPS + OpenAI Tunnel | 已有 VPS、希望所有外部 API 走自己的公网 IP | 不开公网入站端口、Bing 出口可控、适合长期运行 | 需要运行 tunnel-client |

如果你主要用 Google，Workers 很省事；如果你也重度使用 Bing，**VPS + OpenAI Tunnel 更推荐**。

## 能做什么？

目前提供 17 个 MCP Tools：

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

其中 `indexing_submit` 会产生真实外部写操作，可调用：

- Google Indexing API
- Bing URL Submission
- IndexNow

> Google 官方仅将 Indexing API 用于带 `JobPosting`，或 `VideoObject` 中嵌入 `BroadcastEvent` 的页面。普通博客页面不属于官方支持场景。HTTP 200 也不代表一定被收录或提升排名。

## 项目结构

```text
src/
├── core/                    # 与部署方式无关的业务能力
│   ├── google.js
│   ├── bing.js
│   ├── pagespeed.js
│   ├── indexing.js
│   ├── intelligence.js
│   ├── technical.js
│   ├── tools.js
│   └── mcp.js
└── runtime/
    ├── worker/              # Cloudflare Workers Remote MCP
    │   ├── index.js
    │   ├── oauth.js
    │   └── oauth-state.js
    └── stdio.js             # VPS / OpenAI Tunnel

docs/
├── workers.md
└── openai-tunnel.md
```

Core 不知道自己跑在 Worker 还是 VPS。两种运行时最终都调用同一个 `handleMcp()` 和同一组 Tools。

---

## 快速开始 A：Cloudflare Workers

适合第一次体验。

```bash
git clone https://github.com/fx-k/search-console-mcp-workers.git
cd search-console-mcp-workers

npm install
npx wrangler login
npm run worker:deploy
```

首次部署后配置 4 个 Secret：

```bash
npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON < /path/to/google-service-account.json
npx wrangler secret put BING_API_KEY
npx wrangler secret put OAUTH_PASSWORD
npx wrangler secret put OAUTH_JWT_SECRET
```

如果使用 IndexNow，再在 Cloudflare Worker 的 Variables 中增加公开变量：

```text
INDEXNOW_KEY=<你的 IndexNow key>
```

`wrangler.toml` 已启用 `keep_vars = true`，后续代码部署不会覆盖你在 Dashboard 中维护的普通变量。

部署后的 MCP 地址：

```text
https://<worker>.workers.dev/mcp
```

Workers 版本自带 OAuth + PKCE + SQLite Durable Object，不需要额外 OAuth 服务。

完整步骤见：[Cloudflare Workers 部署](docs/workers.md)。

### 关于 Bing 的 `ThrottleIP`

Workers 运行方式下，Bing API 的请求从 Cloudflare 出口发出。共享出口 IP 有时会被 Bing Webmaster API 限流，典型错误：

```text
ERROR!!! ThrottleIP
```

项目不会通过重试风暴或隐藏错误来“绕过”它。

如果本机 / VPS 使用同一把 Bing API Key 正常，而 Worker 返回 `ThrottleIP`，建议直接切到 VPS + OpenAI Tunnel。

---

## 快速开始 B：VPS + OpenAI Tunnel

这是推荐的「自有出口 IP」模式。

OpenAI Tunnel 由 VPS **主动向 OpenAI 建立出站 HTTPS 连接**，Tunnel 本身不要求开放公网入站端口。官方 tunnel-client 同时支持 Streamable HTTP 和 stdio；本项目使用更简单的 **stdio** 绑定。

### 1. VPS 准备应用

要求 Node.js 22+：

```bash
git clone https://github.com/fx-k/search-console-mcp-workers.git /opt/search-console-mcp
cd /opt/search-console-mcp
npm install --omit=dev
```

把 Google Service Account JSON 放到：

```text
/etc/search-console-mcp/google-service-account.json
```

准备环境变量：

```bash
export GOOGLE_SERVICE_ACCOUNT_FILE=/etc/search-console-mcp/google-service-account.json
export BING_API_KEY='你的 Bing Webmaster API Key'
export INDEXNOW_KEY='你的 IndexNow Key'
```

可以先直接验证 stdio：

```bash
npm run stdio
```

它不会监听公网端口，只通过 stdin/stdout 收发 MCP JSON-RPC。

### 2. 用 OpenAI Tunnel 连接

先按 OpenAI 官方文档安装 `tunnel-client`，然后准备：

```bash
export CONTROL_PLANE_API_KEY='sk-...'
export CONTROL_PLANE_TUNNEL_ID='tunnel_...'
```

推荐先让官方 CLI 生成配置，而不是手写 YAML：

```bash
tunnel-client init \
  --sample sample_mcp_stdio_local \
  --profile search-console-mcp \
  --tunnel-id "$CONTROL_PLANE_TUNNEL_ID" \
  --mcp-command "node /opt/search-console-mcp/src/runtime/stdio.js"

tunnel-client doctor --profile search-console-mcp --explain
tunnel-client run --profile search-console-mcp
```

Tunnel ready 后，再在 ChatGPT 中选择对应 `tunnel_id` 建立连接。

> stdio 模式下，同一个 tunnel ID 只应运行一个活跃的 tunnel-client 实例，避免 MCP 会话被分发到不同 child process。

完整 VPS / systemd 步骤见：[OpenAI Tunnel 部署](docs/openai-tunnel.md)。

---

## Google 凭据

同一份 Google Service Account 用于：

```text
Google Search Console → webmasters.readonly
Google Indexing API   → indexing
PageSpeed Insights    → OAuth
```

如果需要 Google Indexing API，该 Service Account 需要在对应 Search Console Property 中具有 Owner 权限。

Workers 使用：

```text
GOOGLE_SERVICE_ACCOUNT_JSON
```

Tunnel / VPS 使用：

```text
GOOGLE_SERVICE_ACCOUNT_FILE
```

VPS 版本故意只接受文件路径，不再维护“JSON 字符串 / 文件 / Base64”多套兼容配置。

## 一些容易误解的返回值

**Google Indexing status 404**

项目会把“没有历史 Indexing API notification metadata”的 404 表达为：

```json
{
  "ok": true,
  "notified": false
}
```

它不等于“Google 没有收录这个 URL”。真实收录状态请用 `inspection_inspect`。

**IndexNow status**

`indexing_status(method="indexnow")` 会实际读取：

```text
https://<host>/<INDEXNOW_KEY>.txt
```

并返回 `verificationFetchStatus` 与 `verificationMatches`。

**搜索词缺失**

Search Console / Webmaster API 可能因为隐私或平台规则省略部分 query rows。缺失不等于流量为 0。

## 本地开发

```bash
npm install
npm run check
npm test
npm run worker:build
```

Workers 本地开发：

```bash
npm run worker:dev
```

Tunnel stdio：

```bash
GOOGLE_SERVICE_ACCOUNT_FILE=/path/to/key.json \
BING_API_KEY=... \
INDEXNOW_KEY=... \
npm run stdio
```

CI 会同时检查共享 Core、Workers runtime 和 stdio runtime。

## 安全边界

- Google / Bing / API 返回的 query、URL、title 等全部视为不可信数据，不作为指令执行。
- Workers Remote MCP 使用 OAuth + PKCE S256；OAuth code / refresh token 状态存放在 SQLite Durable Object。
- Tunnel 版不暴露额外公网 MCP 端口，连接由 tunnel-client 主动发起。
- Service Account JSON、Bing API Key、OAuth Secret 等不得提交到仓库。
- `indexing_submit` 是真实写工具；MCP Client 仍可能根据自身权限策略要求确认。

## OpenAI Tunnel 官方资料

- [openai/tunnel-client](https://github.com/openai/tunnel-client)
- [Connectors / MCP transports](https://github.com/openai/tunnel-client/blob/master/docs/connectors.md)
- [VM / systemd deployment](https://github.com/openai/tunnel-client/blob/master/docs/deployment/systemd-vm.md)

## License & Attribution

MIT License。上游与设计来源见 [NOTICE.md](NOTICE.md)。
