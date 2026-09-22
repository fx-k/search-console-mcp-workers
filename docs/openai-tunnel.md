# VPS + OpenAI Tunnel 部署

适合希望 Search Console MCP 从**自己的服务器公网 IP**访问 Google / Bing 的场景。

尤其当 Cloudflare Workers 调 Bing Webmaster API 遇到 `ThrottleIP` 时，这种部署方式更合适。

## 网络模型

```text
ChatGPT
   │
   ▼
OpenAI Tunnel Service
   ▲
   │ VPS 主动发起 HTTPS 连接
   │
VPS: tunnel-client
   │ stdio
   ▼
Search Console MCP
   │
   ├─ Google
   ├─ Bing  ← Bing 看到的是 VPS 出口 IP
   ├─ PageSpeed
   └─ IndexNow
```

OpenAI tunnel-client 官方要求 VPS 能出站访问：

```text
api.openai.com:443
/v1/tunnels/*
```

Tunnel 本身**不要求开放公网入站端口**。

## 1. 安装应用

以下路径只是推荐值：

```bash
sudo mkdir -p /opt/search-console-mcp /etc/search-console-mcp

git clone https://github.com/fx-k/search-console-mcp-workers.git /opt/search-console-mcp
cd /opt/search-console-mcp

npm install --omit=dev
```

要求 Node.js 22+。

## 2. 放置 Google Service Account

```text
/etc/search-console-mcp/google-service-account.json
```

建议权限：

```bash
sudo chmod 600 /etc/search-console-mcp/google-service-account.json
```

Tunnel runtime 只读取 `GOOGLE_SERVICE_ACCOUNT_FILE`，不会同时维护 JSON 字符串、Base64 等备用配置。

## 3. 准备 MCP 环境

```bash
export GOOGLE_SERVICE_ACCOUNT_FILE=/etc/search-console-mcp/google-service-account.json
export BING_API_KEY='your-bing-api-key'
export INDEXNOW_KEY='your-indexnow-key'
```

其中：

- Google 文件：必需
- Bing key：只在使用 Bing 时需要
- IndexNow key：只在使用 IndexNow 时需要，而且它本身是公开验证值

先验证 stdio 能启动：

```bash
cd /opt/search-console-mcp
npm run stdio
```

看到 stderr：

```text
[search-console-mcp] stdio runtime ready
```

即说明 runtime 已就绪。它不会监听 TCP 端口。

## 4. 安装 OpenAI tunnel-client

使用 OpenAI 官方提供的 tunnel-client 版本与安装方法：

- https://github.com/openai/tunnel-client
- https://github.com/openai/tunnel-client/blob/master/docs/onboarding.md

准备 runtime key 与 tunnel id：

```bash
export CONTROL_PLANE_API_KEY='sk-...'
export CONTROL_PLANE_TUNNEL_ID='tunnel_...'
```

注意不要把 Admin Key 当 runtime key 长期放在服务里。

## 5. 创建 stdio profile

官方 CLI 支持 `sample_mcp_stdio_local`：

```bash
tunnel-client init \
  --sample sample_mcp_stdio_local \
  --profile search-console-mcp \
  --tunnel-id "$CONTROL_PLANE_TUNNEL_ID" \
  --mcp-command "node /opt/search-console-mcp/src/runtime/stdio.js"
```

检查：

```bash
tunnel-client doctor --profile search-console-mcp --explain
```

运行：

```bash
tunnel-client run --profile search-console-mcp
```

默认健康检查可从 VPS 本机访问：

```bash
curl -fsS http://127.0.0.1:8080/healthz
curl -fsS http://127.0.0.1:8080/readyz
```

只有 Tunnel ready 后再去 ChatGPT 测 Tools。

## 6. systemd 长期运行

仓库提供：

- `deploy/systemd/search-console-mcp.env.example`
- `deploy/systemd/search-console-mcp-tunnel.service.example`

建议创建专用系统用户，并确保：

```text
/etc/search-console-mcp/google-service-account.json
/etc/search-console-mcp/search-console-mcp.env
/etc/search-console-mcp/openai-tunnel-api-key
```

只有该服务用户和 root 可读。

启用服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now search-console-mcp-tunnel
sudo systemctl status search-console-mcp-tunnel
```

日志：

```bash
journalctl -u search-console-mcp-tunnel -f
```

## stdio 的部署约束

OpenAI 官方 tunnel-client 文档明确说明：使用 stdio binding 时，同一个 tunnel ID 不应同时运行多个活跃 tunnel-client 实例。

因此不要对同一个 `tunnel_id` 做“双机同时在线”或重叠式滚动重启。

这也是 systemd 模式建议：

```text
一个 tunnel ID
     ↓
一个 tunnel-client
     ↓
一个 Search Console MCP stdio child
```

## 为什么 Bing 在这里更稳定？

Cloudflare Workers 模式的 Bing 请求从 Cloudflare 出口发出；Tunnel 模式下，`bing.js` 实际由 VPS 上的 Node.js 进程执行，因此 Bing 看到的是 VPS 的公网出口 IP。

Tunnel 并不代理你 MCP 对 Bing 的出站流量：

```text
OpenAI Tunnel：负责 ChatGPT → VPS MCP
VPS 网络：负责 VPS MCP → Bing
```

所以它正好适合解决共享出口 IP 被 Bing `ThrottleIP` 的情况。
