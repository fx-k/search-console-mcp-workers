import { TOOLS, VERSION } from './tools.js';
import { oauth, verifyAccess, json, escapeHtml } from './oauth.js';
import { handleMcp, protocols, err } from './mcp.js';
import { googleConfigured } from './google.js';
import { bingConfigured } from './bing.js';
import { pagespeedConfigured, pagespeedAuthMode } from './pagespeed.js';
export { OAuthState } from './oauth-state.js';

async function bounded(request) {
  const maximum = 256 * 1024;
  if (Number(request.headers.get('Content-Length')) > maximum) throw new Error('Request too large');
  if (!request.body) return request;
  const reader = request.body.getReader();
  const chunks = [];
  let count = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    count += value.byteLength;
    if (count > maximum) { await reader.cancel(); throw new Error('Request too large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(count);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new Request(request.url, { method: request.method, headers: request.headers, body: bytes });
}

export default {
  async fetch(initial, env) {
    const url = new URL(initial.url);
    const path = url.pathname;
    const origin = initial.headers.get('Origin');
    const configuredOrigins = String(env.CORS_ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean);
    const allowed = [url.origin, ...configuredOrigins];
    const contentType = (initial.headers.get('Content-Type') || '').toLowerCase();
    const oauthNullOriginForm = origin === 'null' && path === '/authorize' && initial.method === 'POST' && contentType.startsWith('application/x-www-form-urlencoded');
    if (origin && !allowed.includes(origin) && !oauthNullOriginForm) return json({ error: 'origin_not_allowed' }, 403);
    const corsOrigin = origin && allowed.includes(origin) ? origin : null;
    const cors = corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin, Vary: 'Origin', 'Access-Control-Allow-Headers': 'Authorization,Content-Type,Accept,MCP-Protocol-Version', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Expose-Headers': 'WWW-Authenticate' } : {};
    if (initial.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    let request = initial;
    if (initial.method === 'POST') { try { request = await bounded(initial); } catch { return json({ error: 'request_too_large' }, 413, cors); } }
    const authResponse = await oauth(request, env);
    if (authResponse) { const out = new Response(authResponse.body, authResponse); for (const [k, v] of Object.entries(cors)) out.headers.set(k, v); return out; }

    if (path === '/health') return json({
      ok: true, version: VERSION, toolCount: TOOLS.length,
      oauthConfigured: !!env.OAUTH_STATE && !!env.OAUTH_PASSWORD && !!env.OAUTH_JWT_SECRET,
      integrations: { google: googleConfigured(env), bing: bingConfigured(env), pagespeed: { configured: pagespeedConfigured(env), auth: pagespeedAuthMode(env) }, googleIndexing: !!(env.GOOGLE_INDEXING_SERVICE_ACCOUNT_JSON || env.GOOGLE_SERVICE_ACCOUNT_JSON), indexNow: !!env.INDEXNOW_KEY },
      writeToolsExposed: true
    }, 200, cors);

    if (path === '/') return new Response(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Search Console MCP</title><h1>Search Console MCP v${VERSION}</h1><p>Google Search Console + Bing Webmaster Tools + PageSpeed + URL Submission Remote MCP。</p><p>ChatGPT Remote MCP URL:</p><pre>${escapeHtml(url.origin)}/mcp</pre><ul>${TOOLS.map(t => `<li><code>${t.name}</code> — ${escapeHtml(t.title)}</li>`).join('')}</ul></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff' } });

    if (['/sse', '/message'].includes(path)) return json({ error: 'legacy_transport_removed', message: '请使用 /mcp Streamable HTTP' }, 410, cors);
    if (path !== '/mcp') return json({ error: 'not_found' }, 404, cors);
    if (!await verifyAccess(request, env)) return json({ error: 'invalid_token' }, 401, { ...cors, 'WWW-Authenticate': `Bearer resource_metadata="${url.origin}/.well-known/oauth-protected-resource"` });
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { ...cors, Allow: 'POST' });
    const version = request.headers.get('MCP-Protocol-Version');
    if (version && !protocols.includes(version)) return json({ error: 'unsupported_protocol_version' }, 400, cors);
    let msg;
    try { msg = await request.json(); } catch { return json(err(null, -32700, 'Parse error'), 400, cors); }
    const result = await handleMcp(env, msg);
    return result === null ? new Response(null, { status: 202, headers: cors }) : json(result, 200, cors);
  }
};
