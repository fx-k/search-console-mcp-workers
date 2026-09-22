import { b64url, signRs256 } from './crypto.js';
import { validateDateRange } from './validation.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
let cachedToken = null;

function serviceAccount(env) {
  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) throw new Error('Google Search Console 未配置：缺少 GOOGLE_SERVICE_ACCOUNT_JSON');
  let account;
  try { account = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON); } catch { throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON 不是有效 JSON'); }
  if (!account.client_email || !account.private_key) throw new Error('Google service account JSON 缺少 client_email/private_key');
  return account;
}

async function accessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp > now + 120) return cachedToken.value;
  const account = serviceAccount(env);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: account.client_email, scope: SCOPE, aud: account.token_uri || TOKEN_URL, iat: now, exp: now + 3600 }));
  const signingInput = `${header}.${claims}`;
  const signature = b64url(await signRs256(account.private_key, signingInput));
  const assertion = `${signingInput}.${signature}`;
  const response = await fetch(account.token_uri || TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new Error(`Google OAuth token exchange failed (${response.status}): ${data.error_description || data.error || 'unknown error'}`);
  cachedToken = { value: data.access_token, exp: now + Number(data.expires_in || 3600) };
  return cachedToken.value;
}

async function googleRequest(env, url, options = {}) {
  const token = await accessToken(env);
  const response = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || data?.error_description || response.statusText || 'unknown error';
    throw new Error(`Google Search Console API error (${response.status}): ${message}`);
  }
  return data;
}

export async function googleSites(env) {
  const data = await googleRequest(env, 'https://searchconsole.googleapis.com/webmasters/v3/sites');
  return data.siteEntry || [];
}

export async function resolveGoogleSite(env, input) {
  if (String(input).startsWith('sc-domain:')) return String(input);
  const wanted = new URL(input);
  const sites = await googleSites(env);
  const domain = `sc-domain:${wanted.hostname.toLowerCase()}`;
  if (sites.some(s => s.siteUrl === domain)) return domain;
  const exact = sites.find(s => {
    if (!s.siteUrl?.startsWith('http')) return false;
    try { return new URL(s.siteUrl).href === wanted.href || new URL(s.siteUrl).origin === wanted.origin; } catch { return false; }
  });
  if (exact) return exact.siteUrl;
  throw new Error(`Google Search Console 中找不到 ${wanted.hostname} 对应的资源`);
}

export async function googleSitemaps(env, siteInput) {
  const siteUrl = await resolveGoogleSite(env, siteInput);
  const data = await googleRequest(env, `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/sitemaps`);
  return { siteUrl, sitemaps: data.sitemap || [] };
}

function googleFilters(args) {
  const filters = [];
  for (const [dimension, value] of [['query', args.queryContains], ['page', args.pageContains], ['country', args.country], ['device', args.device]]) {
    if (value !== undefined) filters.push({ dimension, operator: dimension === 'query' || dimension === 'page' ? 'contains' : 'equals', expression: value });
  }
  return filters.length ? [{ groupType: 'and', filters }] : undefined;
}

export async function googleAnalytics(env, args) {
  validateDateRange(args.startDate, args.endDate);
  const siteUrl = await resolveGoogleSite(env, args.siteUrl);
  const body = {
    startDate: args.startDate,
    endDate: args.endDate,
    dimensions: args.dimensions || ['query'],
    rowLimit: args.rowLimit || 100,
    startRow: args.startRow || 0,
    type: args.searchType || 'web',
    dimensionFilterGroups: googleFilters(args)
  };
  Object.keys(body).forEach(k => body[k] === undefined && delete body[k]);
  const data = await googleRequest(env, `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, { method: 'POST', body: JSON.stringify(body) });
  return { siteUrl, responseAggregationType: data.responseAggregationType, rows: data.rows || [] };
}

export async function googleInspect(env, siteInput, urls) {
  const siteUrl = await resolveGoogleSite(env, siteInput);
  const results = await Promise.all(urls.map(async inspectionUrl => {
    try {
      const data = await googleRequest(env, 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', {
        method: 'POST',
        body: JSON.stringify({ inspectionUrl, siteUrl, languageCode: 'zh-CN' })
      });
      return { url: inspectionUrl, ok: true, result: data.inspectionResult || data };
    } catch (e) {
      return { url: inspectionUrl, ok: false, error: e.message };
    }
  }));
  return { siteUrl, results };
}

export function googleConfigured(env) {
  try { serviceAccount(env); return true; } catch { return false; }
}
