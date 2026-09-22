# Search Console MCP on Cloudflare Workers

Read-only **Google Search Console + Bing Webmaster Tools + PageSpeed Insights** Remote MCP for Cloudflare Workers, designed for ChatGPT and other clients that support authenticated Streamable HTTP MCP.

This is a Workers-oriented adapter aligned with [saurabhsharma2u/search-console-mcp](https://github.com/saurabhsharma2u/search-console-mcp). It does **not** run the upstream Node CLI inside Workers; local filesystem/keychain auth is replaced by Worker Secrets and WebCrypto-friendly REST calls.

## Current v0.2 scope

The Worker intentionally exposes only read operations:

- Core reads: `connection_status`, `sites_list`, `sitemaps_list`, `analytics_query`, `inspection_inspect`
- Search diagnostics: `bing_crawl_issues`, `pagespeed_analyze`, `site_health_check`, `schema_inspect`
- Cross-period / cross-engine: `compare_engines`, `analytics_compare`, `analytics_anomalies`
- SEO intelligence: `seo_audit`, `seo_keywords_research`, `genai_query_insights`

`seo_audit` supports quick wins, striking-distance queries, low-CTR candidates and possible query cannibalization. `genai_query_insights` is explicitly heuristic: Google/Bing do not expose an official AI Overview / AI Mode / GenAI citation flag through these APIs.

No sitemap submission, URL submission, indexing submission, site deletion, or other external write action is exposed.

## Architecture

```text
ChatGPT / MCP client
        │ HTTPS + OAuth (PKCE)
        ▼
Cloudflare Worker /mcp
   ├─ OAuth gate + SQLite Durable Object state
   ├─ Google Search Console REST
   │    └─ restricted service account / webmasters.readonly
   ├─ Bing Webmaster Tools REST
   │    └─ API key
   └─ PageSpeed Insights REST
```

External credentials are stored only as Cloudflare Worker Secrets. OAuth authorization codes and refresh tokens used by the MCP client are stored in a SQLite-backed Durable Object and consumed atomically.

## Required secrets

```bash
npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON
npx wrangler secret put BING_API_KEY
npx wrangler secret put OAUTH_PASSWORD
npx wrangler secret put OAUTH_JWT_SECRET
```

Optional but recommended for stable PageSpeed quota:

```bash
npx wrangler secret put PAGESPEED_API_KEY
```

### `GOOGLE_SERVICE_ACCOUNT_JSON`

Paste the **entire downloaded service-account JSON file** as the secret value. Do not commit it, upload it to issues, or split the private key into normal `[vars]`.

The service account should be added to the target Search Console property with the minimum permissions needed. This Worker only requests:

```text
https://www.googleapis.com/auth/webmasters.readonly
```

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

Google Indexing API, Bing URL submission and IndexNow are write paths and remain out of scope for the read-only Plugin profile.

## Security notes

- `OAUTH_PASSWORD` must be at least 16 characters.
- `OAUTH_JWT_SECRET` must be an independent random value of at least 32 characters.
- Keep `CORS_ALLOWED_ORIGINS` exact. Do not replace it with `*`.
- Google/Bing/API-returned text is untrusted data and is not treated as instructions.
- The Worker intentionally exposes no external write tools in v0.2.
- Cloudflare free-tier suitability depends on real request/CPU/storage usage and upstream API quotas; it is not an unlimited-use guarantee.

See [NOTICE.md](NOTICE.md) for upstream attribution.
