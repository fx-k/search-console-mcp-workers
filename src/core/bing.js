import { validateDateRange } from './validation.js';

const BASE = 'https://ssl.bing.com/webmaster/api.svc/json';

function apiKey(env) {
  if (!env.BING_API_KEY) throw new Error('Bing Webmaster 未配置：缺少 BING_API_KEY');
  return env.BING_API_KEY;
}

async function bingRequest(env, method, params = {}, isPost = false) {
  const url = new URL(`${BASE}/${method}`);
  url.searchParams.set('apikey', apiKey(env));
  const options = { method: isPost ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' } };
  if (isPost) options.body = JSON.stringify(params);
  else for (const [key, value] of Object.entries(params)) if (value !== undefined) url.searchParams.set(key, String(value));
  const response = await fetch(url, options);
  const data = await response.json().catch(async () => ({ error: await response.text().catch(() => '') }));
  if (!response.ok) throw new Error(`Bing Webmaster API error (${method}, ${response.status}): ${data?.Message || data?.error || response.statusText}`);
  return data && Object.hasOwn(data, 'd') ? data.d : data;
}

export async function bingSites(env) {
  return bingRequest(env, 'GetUserSites');
}

export async function resolveBingSite(_env, input) {
  const raw = String(input).trim();
  if (raw.startsWith('sc-domain:')) {
    const host = raw.slice('sc-domain:'.length).toLowerCase();
    if (!host) throw new Error('Bing siteUrl 不能为空');
    return 'https://' + host + '/';
  }
  const wanted = new URL(raw);
  if (!['http:', 'https:'].includes(wanted.protocol)) throw new Error('Bing siteUrl 必须使用 http/https');
  return wanted.protocol + '//' + wanted.host + '/';
}

export function normalizeBingDate(value) {
  if (!value) return null;
  const microsoft = String(value).match(/^\/Date\((\d+)(?:[+-]\d+)?\)\/$/u);
  const date = microsoft ? new Date(Number(microsoft[1])) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function inRange(row, startDate, endDate) {
  const date = normalizeBingDate(row.Date);
  if (!date) return true;
  return (!startDate || date >= startDate) && (!endDate || date <= endDate);
}

export async function bingSitemaps(env, siteInput) {
  const siteUrl = await resolveBingSite(env, siteInput);
  const feeds = await bingRequest(env, 'GetFeeds', { siteUrl });
  return { siteUrl, sitemaps: feeds || [] };
}

export async function bingAnalytics(env, args) {
  validateDateRange(args.startDate, args.endDate);
  const siteUrl = await resolveBingSite(env, args.siteUrl);
  const dimensions = args.dimensions || ['query'];
  let method;
  if (dimensions.includes('query') && dimensions.includes('page')) method = 'GetQueryPageStats';
  else if (dimensions.includes('query')) method = 'GetQueryStats';
  else if (dimensions.includes('page')) method = 'GetPageStats';
  else method = 'GetRankAndTrafficStats';
  let rows = await bingRequest(env, method, { siteUrl });
  rows = (rows || []).filter(row => inRange(row, args.startDate, args.endDate));
  if (args.queryContains) rows = rows.filter(row => String(row.Query || '').toLowerCase().includes(String(args.queryContains).toLowerCase()));
  if (args.pageContains) rows = rows.filter(row => String(row.Page || (method === 'GetPageStats' ? row.Query : '')).toLowerCase().includes(String(args.pageContains).toLowerCase()));
  return { siteUrl, sourceMethod: method, rows: rows.slice(args.startRow || 0, (args.startRow || 0) + (args.rowLimit || 100)) };
}

export async function bingInspect(env, siteInput, urls) {
  const siteUrl = await resolveBingSite(env, siteInput);
  const results = await Promise.all(urls.map(async url => {
    try { return { url, ok: true, result: await bingRequest(env, 'GetUrlInfo', { siteUrl, url }) }; }
    catch (e) { return { url, ok: false, error: e.message }; }
  }));
  return { siteUrl, results };
}

export async function bingCrawlIssues(env, siteInput) {
  const siteUrl = await resolveBingSite(env, siteInput);
  const issues = await bingRequest(env, 'GetCrawlIssues', { siteUrl });
  return { siteUrl, issues: issues || [] };
}

export function bingConfigured(env) { return typeof env.BING_API_KEY === 'string' && env.BING_API_KEY.length > 0; }


export async function bingKeywordStats(env, q, country, language) {
  return bingRequest(env, 'GetKeywordStats', { q, country, language });
}

export async function bingRelatedKeywords(env, q, country, language) {
  return bingRequest(env, 'GetRelatedKeywords', { q, country, language });
}


export async function bingSubmissionQuota(env, siteInput) {
  const siteUrl = await resolveBingSite(env, siteInput);
  const quota = await bingRequest(env, 'GetUrlSubmissionQuota', { siteUrl });
  return { siteUrl, quota };
}

export async function bingSubmitUrls(env, siteInput, urls) {
  const siteUrl = await resolveBingSite(env, siteInput);
  const quota = await bingRequest(env, 'GetUrlSubmissionQuota', { siteUrl });
  if (!Array.isArray(urls) || !urls.length) throw new Error('urls 不能为空');
  if (urls.length > 500) throw new Error('Bing SubmitUrlBatch 单次最多 500 个 URL');
  const siteHost = new URL(siteUrl).hostname.toLowerCase();
  for (const value of urls) {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Bing 提交 URL 必须使用 http/https');
    if (url.hostname.toLowerCase() !== siteHost) throw new Error('Bing 提交 URL 必须属于已验证站点 ' + siteHost);
  }
  if (urls.length === 1) {
    await bingRequest(env, 'SubmitUrl', { siteUrl, url: urls[0] }, true);
  } else {
    await bingRequest(env, 'SubmitUrlBatch', { siteUrl, urlList: urls }, true);
  }
  return { ok: true, siteUrl, submitted: urls.length, urls, quotaBefore: quota };
}
