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

export async function resolveBingSite(env, input) {
  const sites = await bingSites(env);
  const raw = String(input);
  if (raw.startsWith('sc-domain:')) {
    const host = raw.slice('sc-domain:'.length).toLowerCase();
    const matches = sites.filter(s => { try { return new URL(s.Url).hostname.toLowerCase() === host; } catch { return false; } });
    if (matches.length) return (matches.find(s => String(s.Url).startsWith('https://')) || matches[0]).Url;
    throw new Error(`Bing Webmaster 中找不到 ${host} 对应的站点`);
  }
  const wanted = new URL(raw);
  const exact = sites.find(s => { try { const u = new URL(s.Url); return u.href === wanted.href || u.origin === wanted.origin; } catch { return false; } });
  if (exact) return exact.Url;
  const host = sites.find(s => { try { return new URL(s.Url).hostname.toLowerCase() === wanted.hostname.toLowerCase(); } catch { return false; } });
  if (host) return host.Url;
  throw new Error(`Bing Webmaster 中找不到 ${wanted.hostname} 对应的站点`);
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
