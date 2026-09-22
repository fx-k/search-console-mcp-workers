import { normalizeHttpUrl } from './validation.js';
import { b64url, signRs256 } from './crypto.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const PAGESPEED_SCOPE = 'openid';
let cachedToken = null;

function serviceAccount(env) {
  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    throw new Error('PageSpeed OAuth 未配置：缺少 GOOGLE_SERVICE_ACCOUNT_JSON');
  }
  let account;
  try {
    account = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON 不是有效 JSON');
  }
  if (!account.client_email || !account.private_key) {
    throw new Error('Google service account JSON 缺少 client_email/private_key');
  }
  return account;
}

async function accessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp > now + 120) return cachedToken.value;

  const account = serviceAccount(env);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: account.client_email,
    scope: PAGESPEED_SCOPE,
    aud: account.token_uri || TOKEN_URL,
    iat: now,
    exp: now + 3600
  }));

  const signingInput = header + '.' + claims;
  const signature = b64url(await signRs256(account.private_key, signingInput));
  const assertion = signingInput + '.' + signature;

  const response = await fetch(account.token_uri || TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(
      'PageSpeed OAuth token exchange failed (' +
      response.status +
      '): ' +
      (data.error_description || data.error || 'unknown error')
    );
  }

  cachedToken = {
    value: data.access_token,
    exp: now + Number(data.expires_in || 3600)
  };
  return cachedToken.value;
}

export async function pagespeedAnalyze(env, inputUrl, strategy = 'mobile') {
  const target = normalizeHttpUrl(inputUrl);
  const url = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
  url.searchParams.set('url', target);
  url.searchParams.set('strategy', strategy);
  url.searchParams.append('category', 'performance');

  const token = await accessToken(env);
  const response = await fetch(url, {
    headers: { Authorization: 'Bearer ' + token }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      'PageSpeed Insights API error (' +
      response.status +
      '): ' +
      (data?.error?.message || response.statusText)
    );
  }

  const lr = data.lighthouseResult || {};
  const audits = lr.audits || {};
  const pick = id => audits[id]
    ? {
        displayValue: audits[id].displayValue,
        numericValue: audits[id].numericValue,
        score: audits[id].score
      }
    : null;

  return {
    id: data.id || target,
    strategy,
    lighthouseVersion: lr.lighthouseVersion,
    performanceScore: lr.categories?.performance?.score ?? null,
    lab: {
      firstContentfulPaint: pick('first-contentful-paint'),
      largestContentfulPaint: pick('largest-contentful-paint'),
      totalBlockingTime: pick('total-blocking-time'),
      cumulativeLayoutShift: pick('cumulative-layout-shift'),
      speedIndex: pick('speed-index')
    },
    field: data.loadingExperience || null,
    originField: data.originLoadingExperience || null,
    warnings: lr.runWarnings || []
  };
}

export function pagespeedConfigured(env) {
  try {
    serviceAccount(env);
    return true;
  } catch {
    return false;
  }
}
