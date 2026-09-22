# Cloudflare Workers 部署

这是最省事的部署方式：Worker 直接提供 Remote MCP endpoint，并内置 OAuth。

## 架构

```text
ChatGPT / MCP Client
        │ HTTPS + OAuth
        ▼
Cloudflare Worker /mcp
        │
        ├─ Google Search Console
        ├─ Google Indexing API
        ├─ PageSpeed Insights
        ├─ Bing Webmaster Tools
        └─ IndexNow
```

## 前置条件

- Node.js 22+
- Cloudflare 账号
- Google Service Account JSON
- Bing Webmaster API Key（如果使用 Bing）
- IndexNow key（如果使用 IndexNow）

Google Service Account 至少需要目标 Search Console Property 权限；如果还要调用 Google Indexing API，需要 Owner。

## 第一次部署

```bash
npm install
npx wrangler login
npm run worker:deploy
```

Worker 名称默认是 `search-console-mcp`。

## 配置 Secret

```bash
npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON < /path/to/google-service-account.json
npx wrangler secret put BING_API_KEY
npx wrangler secret put OAUTH_PASSWORD
npx wrangler secret put OAUTH_JWT_SECRET
```

要求：

- `OAUTH_PASSWORD` 至少 16 字符
- `OAUTH_JWT_SECRET` 至少 32 字符，并与登录密码独立

## 配置 IndexNow

IndexNow key 是公开验证值，不是 Secret。

在 Cloudflare Dashboard 的 Worker Variables 中增加：

```text
INDEXNOW_KEY=<your-indexnow-key>
```

项目使用根目录验证方式：

```text
https://example.com/<INDEXNOW_KEY>.txt
```

文件内容必须与 key 完全一致。

`wrangler.toml` 设置了 `keep_vars = true`，因此通过 Dashboard 配置的普通变量会在后续 Wrangler deploy 时保留。

## 验证

```bash
curl -sS https://<worker>.workers.dev/health | python3 -m json.tool
```

正常情况下会看到当前 runtime、工具数量以及各平台配置状态。

MCP endpoint：

```text
https://<worker>.workers.dev/mcp
```

## ChatGPT 连接

在 ChatGPT 的自定义 MCP / Plugin 配置中：

- Title：`Search Console MCP`
- URL：`https://<worker>.workers.dev/mcp`
- Authentication：OAuth

Scan Tools 时会跳转到 Worker 自己的授权页，输入 `OAUTH_PASSWORD` 即可。

## Bing ThrottleIP 风险

Cloudflare Workers 的 API 请求使用 Cloudflare 出口网络。Bing Webmaster API 在部分共享出口上可能返回：

```text
ERROR!!! ThrottleIP
```

判断方法很简单：

```text
同一 Bing API Key
├─ 本机 / VPS 调用正常
└─ Worker 调用 ThrottleIP
```

这种情况下不建议堆 retry、缓存或代理 fallback；直接使用项目的 [VPS + OpenAI Tunnel](openai-tunnel.md) runtime，让 Bing 请求从自己的服务器 IP 发出。
