import { b64url, signRs256 } from './crypto.js';
import { bingSubmitUrls, bingSubmissionQuota } from './bing.js';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_INDEXING_SCOPE = 'https://www.googleapis.com/auth/indexing';
let googleIndexingToken = null;

function googleIndexingAccount(env) {
  const raw = env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('Google Indexing API 未配置 GOOGLE_SERVICE_ACCOUNT_JSON');
  let account;
  try { account = JSON.parse(raw); } catch { throw new Error('Google Indexing service account JSON 不是有效 JSON'); }
  if (!account.client_email || !account.private_key) throw new Error('Google Indexing service account JSON 缺少 client_email/private_key');
  return account;
}

async function googleAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (googleIndexingToken && googleIndexingToken.exp > now + 120) return googleIndexingToken.value;
  const account = googleIndexingAccount(env);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: account.client_email,
    scope: GOOGLE_INDEXING_SCOPE,
    aud: account.token_uri || GOOGLE_TOKEN_URL,
    iat: now,
    exp: now + 3600
  }));
  const signingInput = header + '.' + claims;
  const signature = b64url(await signRs256(account.private_key, signingInput));
  const assertion = signingInput + '.' + signature;
  const response = await fetch(account.token_uri || GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error('Google Indexing OAuth failed (' + response.status + '): ' + (data.error_description || data.error || 'unknown error'));
  }
  googleIndexingToken = { value: data.access_token, exp: now + Number(data.expires_in || 3600) };
  return googleIndexingToken.value;
}

function validateUrls(urls, expectedHost) {
  if (!Array.isArray(urls) || !urls.length) throw new Error('urls 不能为空');
  const normalized = [];
  for (const value of urls) {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) {
      throw new Error('URL 必须是公开 http/https URL，且不能包含凭据或 fragment');
    }
    if (expectedHost && url.hostname.toLowerCase() !== expectedHost.toLowerCase()) {
      throw new Error('URL 必须属于主机 ' + expectedHost);
    }
    normalized.push(url.href);
  }
  return normalized;
}

export async function googleIndexingSubmit(env, urls, action = 'updated') {
  const normalized = validateUrls(urls);
  if (normalized.length > 20) throw new Error('Google Indexing API 在本 Worker 中单次最多提交 20 个 URL');
  const type = action === 'deleted' ? 'URL_DELETED' : 'URL_UPDATED';
  const token = await googleAccessToken(env);
  const results = [];
  for (const url of normalized) {
    const response = await fetch('https://indexing.googleapis.com/v3/urlNotifications:publish', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ url, type })
    });
    const data = await response.json().catch(() => ({}));
    results.push({
      url,
      ok: response.ok,
      status: response.status,
      result: response.ok ? data : undefined,
      error: response.ok ? undefined : (data?.error?.message || response.statusText)
    });
  }
  return {
    provider: 'google-indexing-api',
    action,
    submitted: normalized.length,
    results,
    warning: 'Google officially limits the Indexing API to JobPosting pages and BroadcastEvent embedded in VideoObject. HTTP 200 means the notification was accepted, not that an ordinary blog page will be indexed.'
  };
}

export async function googleIndexingStatus(env, urls) {
  const normalized = validateUrls(urls);
  if (normalized.length > 20) throw new Error('Google Indexing metadata 单次最多查询 20 个 URL');
  const token = await googleAccessToken(env);
  const results = [];
  for (const url of normalized) {
    const endpoint = new URL('https://indexing.googleapis.com/v3/urlNotifications/metadata');
    endpoint.searchParams.set('url', url);
    const response = await fetch(endpoint, { headers: { Authorization: 'Bearer ' + token } });
    const data = await response.json().catch(() => ({}));
    if (response.status === 404) {
      results.push({
        url,
        ok: true,
        status: 404,
        notified: false,
        note: 'No prior Google Indexing API notification metadata exists for this URL.'
      });
      continue;
    }
    results.push({
      url,
      ok: response.ok,
      status: response.status,
      notified: response.ok,
      result: response.ok ? data : undefined,
      error: response.ok ? undefined : (data?.error?.message || response.statusText)
    });
  }
  return { provider: 'google-indexing-api', results };
}

function indexNowConfig(env, urls) {
  if (!env.INDEXNOW_KEY) throw new Error('IndexNow 未配置 INDEXNOW_KEY');
  if (!/^[A-Za-z0-9-]{8,128}$/u.test(env.INDEXNOW_KEY)) throw new Error('INDEXNOW_KEY 必须为 8-128 位字母、数字或连字符');
  const normalized = validateUrls(urls);
  if (normalized.length > 1000) throw new Error('本 Worker 单次最多提交 1000 个 IndexNow URL');
  const host = new URL(normalized[0]).hostname.toLowerCase();
  validateUrls(normalized, host);
  const keyLocation = 'https://' + host + '/' + env.INDEXNOW_KEY + '.txt';
  return { key: env.INDEXNOW_KEY, keyLocation, host, urls: normalized };
}

export async function indexNowSubmit(env, urls) {
  const config = indexNowConfig(env, urls);
  const response = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      host: config.host,
      key: config.key,
      keyLocation: config.keyLocation,
      urlList: config.urls
    })
  });
  const body = await response.text().catch(() => '');
  return {
    provider: 'indexnow',
    ok: response.ok,
    status: response.status,
    submitted: config.urls.length,
    host: config.host,
    keyLocation: config.keyLocation,
    response: body || null,
    note: response.status === 200 ? 'IndexNow endpoint received the URLs.' : response.status === 202 ? 'IndexNow received the URLs; key validation is pending.' : null
  };
}

function siteRootUrl(siteInput) {
  const raw = String(siteInput || '').trim();
  if (!raw) return null;
  if (raw.startsWith('sc-domain:')) {
    const host = raw.slice('sc-domain:'.length).toLowerCase();
    return host ? 'https://' + host + '/' : null;
  }
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('siteUrl 必须使用 http/https');
  return url.protocol + '//' + url.host + '/';
}

export async function indexNowStatus(env, siteInput, urls = []) {
  const configured = typeof env.INDEXNOW_KEY === 'string' && env.INDEXNOW_KEY.length >= 8;
  if (!configured) return { configured: false };

  const candidates = urls.length ? urls : [siteRootUrl(siteInput)].filter(Boolean);
  if (!candidates.length) throw new Error('IndexNow key verification 需要 siteUrl 或 urls');

  const config = indexNowConfig(env, candidates);
  const response = await fetch(config.keyLocation, { redirect: 'follow' });
  const text = (await response.text().catch(() => '')).trim();
  return {
    configured: true,
    host: config.host,
    keyLocation: config.keyLocation,
    verificationFetchStatus: response.status,
    verificationMatches: response.ok && text === config.key
  };
}

export async function indexingSubmit(env, args) {
  if (args.method === 'google') return googleIndexingSubmit(env, args.urls, args.action || 'updated');
  if (args.method === 'bing') return bingSubmitUrls(env, args.siteUrl, args.urls);
  if (args.method === 'indexnow') return indexNowSubmit(env, args.urls);
  throw new Error('Unsupported indexing method: ' + args.method);
}

export async function indexingStatus(env, args) {
  if (args.method === 'google') return googleIndexingStatus(env, args.urls || []);
  if (args.method === 'bing') return bingSubmissionQuota(env, args.siteUrl);
  if (args.method === 'indexnow') return indexNowStatus(env, args.siteUrl, args.urls || []);
  throw new Error('Unsupported indexing status method: ' + args.method);
}
