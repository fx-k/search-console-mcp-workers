# Search Console MCP on Cloudflare Workers

**Google Search Console + Bing Webmaster Tools + PageSpeed Insights + URL submission** Remote MCP for Cloudflare Workers, designed for ChatGPT and other clients that support authenticated Streamable HTTP MCP.

This is a Workers-oriented adapter aligned with [saurabhsharma2u/search-console-mcp](https://github.com/saurabhsharma2u/search-console-mcp). It does **not** run the upstream Node CLI inside Workers; local filesystem/keychain auth is replaced by Worker Secrets and WebCrypto-friendly REST calls.

## Current v0.3 scope

The Worker exposes SEO reads plus URL-submission writes:

- Core reads: `connection_status`, `sites_list`, `sitemaps_list`, `analytics_query`, `inspection_inspect`
- Search diagnostics: `bing_crawl_issues`, `pagespeed_analyze`, `site_health_check`, `schema_inspect`
- Cross-period / cross-engine: `compare_engines`, `analytics_compare`, `analytics_anomalies`
- SEO intelligence: `seo_audit`, `seo_keywords_research`, `genai_query_insights`

`seo_audit` supports quick wins, striking-distance queries, low-CTR candidates and possible query cannibalization. `genai_query_insights` is explicitly heuristic: Google/Bing do not expose an official AI Overview / AI Mode / GenAI citation flag through these APIs.

- URL submission: `indexing_submit` supports Google Indexing API, Bing URL Submission and IndexNow.
- Submission status/quota: `indexing_status` reads Google notification metadata, Bing submission quota or IndexNow key verification.

These URL-submission tools are **enabled whenever their credentials are configured**. There is no separate server-side `WRITE_ENABLED` flag and no `Confirmed=true` parameter. MCP clients may still display their own approval UI because `indexing_submit` is correctly annotated as a write/destructive-capable tool.

## Architecture

```text
ChatGPT / MCP client
        │ HTTPS + OAuth (PKCE)
        ▼
Cloudflare Worker /mcp
   ├─ OAuth gate + SQLite Durable Object state
   ├─ Google Search Console REST
   │    └─ service account / webmasters.readonly
   ├─ Google Indexing API
   │    └─ service account / indexing scope
   ├─ Bing Webmaster Tools REST
   │    └─ API key + URL Submission
   ├─ IndexNow
   │    └─ host key verification
   └─ PageSpeed Insights REST
```

External credentials are stored only as Cloudflare Worker Secrets. OAuth authorization codes and refresh tokens used by the MCP client are stored in a SQLite-backed Durable Object and consumed atomically.

## Required secrets

```bash
npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON
npx wrangler secret put BING_API_KEY
npx wrangler secret put OAUTH_PASSWORD
npx wrangler secret put OAUTH_JWT_SECRET
npx wrangler secret put INDEXNOW_KEY
```

PageSpeed reuses `GOOGLE_SERVICE_ACCOUNT_JSON` through OAuth 2.0. There is no separate PageSpeed API key path.

IndexNow always uses the root key location `https://<submitted-host>/<INDEXNOW_KEY>.txt`. That file must be publicly reachable and contain only the IndexNow key.

### `GOOGLE_SERVICE_ACCOUNT_JSON`

Paste the **entire downloaded service-account JSON file** as the secret value. Do not commit it, upload it to issues, or split the private key into normal `[vars]`.

The service account used for Search Console reads requests:

```text
https://www.googleapis.com/auth/webmasters.readonly
```

Google's Indexing API uses a separate `https://www.googleapis.com/auth/indexing` scope. The same `GOOGLE_SERVICE_ACCOUNT_JSON` identity is used for Search Console and Indexing API, and it must be added as a Search Console **site owner**.

PageSpeed Insights reuses the same `GOOGLE_SERVICE_ACCOUNT_JSON` and requests the API's documented `openid` OAuth scope.

## Local checks

```bash
npm install
npm run check
npm test
npm run build
```

`npm run build` is a Wrangler dry-run. It does not deploy.

## Deploy

```bash
npx wrangler login
npm run deploy
```

Then configure the secrets above. The Remote MCP URL is:

```text
https://<worker>.workers.dev/mcp
```

`GET /health` only reports configuration presence and process health. It never prints secret values and does not prove the external credentials are valid; verify with `sites_list` after deployment.

## ChatGPT connection

Create a custom Remote MCP / Plugin connection using the Worker `/mcp` URL and OAuth. The Worker publishes OAuth discovery, dynamic client registration, PKCE S256, token refresh, and protected-resource metadata. The authorization page is protected by `OAUTH_PASSWORD`.

Start with:

> Show `connection_status`, then list my verified sites from Google and Bing.

Only after both engines pass should cross-engine comparisons be trusted.


## Intentionally not enabled

GA4 and AdSense are supported by the upstream project, but they are not enabled in this Worker by default. This deployment is focused on search/SEO data. GA4 should only be added when a real GA4 property is in use; AdSense additionally requires separate user OAuth because the AdSense Management API does not accept service accounts.

Sitemap deletion, site deletion and other administrative/destructive Webmaster actions are still not exposed.

## Security notes

- `OAUTH_PASSWORD` must be at least 16 characters.
- `OAUTH_JWT_SECRET` must be an independent random value of at least 32 characters.
- Keep `CORS_ALLOWED_ORIGINS` exact. Do not replace it with `*`.
- Google/Bing/API-returned text is untrusted data and is not treated as instructions.
- `indexing_submit` performs real external writes and is enabled when its credentials are present; there is no extra server-side write toggle.
- Google officially limits Indexing API usage to pages containing `JobPosting` or `BroadcastEvent` embedded in `VideoObject`; ordinary blog URLs are outside the documented supported use case.
- Bing/IndexNow accepting a URL notification does not guarantee indexing or ranking.
- Cloudflare free-tier suitability depends on real request/CPU/storage usage and upstream API quotas; it is not an unlimited-use guarantee.

See [NOTICE.md](NOTICE.md) for upstream attribution.
