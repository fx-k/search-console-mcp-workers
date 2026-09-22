import { validate } from './validation.js';
import { googleSites, googleSitemaps, googleAnalytics, googleInspect, googleConfigured, resolveGoogleSite } from './google.js';
import { bingSites, bingSitemaps, bingAnalytics, bingInspect, bingCrawlIssues, bingConfigured, resolveBingSite } from './bing.js';
import { pagespeedAnalyze, pagespeedConfigured } from './pagespeed.js';
import { analyticsCompare, analyticsAnomalies, seoAudit, genaiQueryInsights, keywordResearch } from './intelligence.js';
import { schemaInspect, siteHealthCheck } from './technical.js';
import { indexingSubmit, indexingStatus } from './indexing.js';

export const VERSION = '0.3.2';
const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const writeAction = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };
const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const engine = { type: 'string', enum: ['google', 'bing', 'all'] };
const siteUrl = { type: 'string', minLength: 1, maxLength: 2048 };
const date = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };

export const TOOLS = [
  { name: 'connection_status', title: 'Connection status', description: 'Shows which external API credentials are configured. Does not reveal secret values.', inputSchema: obj({}), annotations: readOnly },
  { name: 'sites_list', title: 'List verified search sites', description: 'Lists verified sites from Google Search Console and/or Bing Webmaster Tools.', inputSchema: obj({ engine }), annotations: readOnly },
  { name: 'sitemaps_list', title: 'List sitemaps', description: 'Reads sitemap/feed status from Google Search Console and/or Bing Webmaster Tools.', inputSchema: obj({ siteUrl, engine }, ['siteUrl']), annotations: readOnly },
  {
    name: 'analytics_query', title: 'Search analytics query', description: 'Reads organic search performance from Google Search Console and/or Bing Webmaster Tools. Google supports richer dimensions; Bing returns the nearest native statistics endpoint.',
    inputSchema: obj({
      siteUrl, engine, startDate: date, endDate: date,
      dimensions: { type: 'array', items: { type: 'string', enum: ['date', 'query', 'page', 'country', 'device', 'searchAppearance'] }, minItems: 1, maxItems: 5, uniqueItems: true },
      rowLimit: { type: 'integer', minimum: 1, maximum: 1000 }, startRow: { type: 'integer', minimum: 0, maximum: 25000 },
      searchType: { type: 'string', enum: ['web', 'image', 'video', 'news'] },
      queryContains: { type: 'string', maxLength: 500 }, pageContains: { type: 'string', maxLength: 2000 }, country: { type: 'string', maxLength: 8 }, device: { type: 'string', enum: ['DESKTOP', 'MOBILE', 'TABLET'] }
    }, ['siteUrl', 'startDate', 'endDate']), annotations: readOnly
  },
  {
    name: 'inspection_inspect', title: 'Inspect URLs', description: 'Reads Google URL Inspection results and/or Bing URL information for up to 10 URLs.',
    inputSchema: obj({ siteUrl, engine: { type: 'string', enum: ['google', 'bing', 'all'] }, urls: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 2048 }, minItems: 1, maxItems: 10, uniqueItems: true } }, ['siteUrl', 'urls']), annotations: readOnly
  },
  { name: 'bing_crawl_issues', title: 'Bing crawl issues', description: 'Lists Bing Webmaster crawl issues for a verified site.', inputSchema: obj({ siteUrl }, ['siteUrl']), annotations: readOnly },
  { name: 'pagespeed_analyze', title: 'PageSpeed analysis', description: 'Runs PageSpeed Insights for one public HTTP(S) URL and returns compact lab/field metrics.', inputSchema: obj({ url: siteUrl, strategy: { type: 'string', enum: ['mobile', 'desktop'] } }, ['url']), annotations: readOnly },
  { name: 'compare_engines', title: 'Compare Google and Bing', description: 'Fetches query or page search performance from Google and Bing in parallel for the same site and period.', inputSchema: obj({ siteUrl, startDate: date, endDate: date, dimension: { type: 'string', enum: ['query', 'page'] }, rowLimit: { type: 'integer', minimum: 1, maximum: 500 } }, ['siteUrl', 'startDate', 'endDate']), annotations: readOnly },
  {
    name: 'analytics_compare', title: 'Compare search periods', description: 'Compares two date ranges on Google and/or Bing and reports clicks, impressions, CTR and average-position deltas.',
    inputSchema: obj({ siteUrl, engine, currentStartDate: date, currentEndDate: date, previousStartDate: date, previousEndDate: date, dimension: { type: 'string', enum: ['date', 'query', 'page'] }, rowLimit: { type: 'integer', minimum: 1, maximum: 1000 } }, ['siteUrl','currentStartDate','currentEndDate','previousStartDate','previousEndDate']), annotations: readOnly
  },
  {
    name: 'analytics_anomalies', title: 'Detect search anomalies', description: 'Detects daily click or impression outliers with a z-score. Descriptive only; it does not infer causes.',
    inputSchema: obj({ siteUrl, engine, startDate: date, endDate: date, metric: { type: 'string', enum: ['clicks','impressions'] }, threshold: { type: 'number', minimum: 1, maximum: 10 } }, ['siteUrl','startDate','endDate']), annotations: readOnly
  },
  {
    name: 'seo_audit', title: 'SEO opportunity audit', description: 'Finds quick wins, striking-distance queries, low-CTR candidates or possible query cannibalization. Candidates are evidence for review, not automatic content-change recommendations.',
    inputSchema: obj({ siteUrl, engine: { type: 'string', enum: ['google','bing'] }, startDate: date, endDate: date, type: { type: 'string', enum: ['quick_wins','striking_distance','low_ctr','cannibalization'] }, minImpressions: { type: 'integer', minimum: 1, maximum: 1000000 }, maxCtr: { type: 'number', minimum: 0, maximum: 1 }, rowLimit: { type: 'integer', minimum: 1, maximum: 1000 }, limit: { type: 'integer', minimum: 1, maximum: 200 } }, ['siteUrl','startDate','endDate','type']), annotations: readOnly
  },
  {
    name: 'seo_keywords_research', title: 'Bing keyword research', description: 'Reads Bing Webmaster keyword statistics or related-keyword data.',
    inputSchema: obj({ keyword: { type: 'string', minLength: 1, maxLength: 300 }, type: { type: 'string', enum: ['stats','related'] }, country: { type: 'string', maxLength: 8 }, language: { type: 'string', maxLength: 16 } }, ['keyword','type']), annotations: readOnly
  },
  {
    name: 'genai_query_insights', title: 'Conversational query insights', description: 'Heuristically flags conversational-looking search queries. This is not an official AI Overview, AI Mode or GenAI citation signal.',
    inputSchema: obj({ siteUrl, engine, startDate: date, endDate: date, minImpressions: { type: 'integer', minimum: 1, maximum: 1000000 }, rowLimit: { type: 'integer', minimum: 1, maximum: 1000 }, limit: { type: 'integer', minimum: 1, maximum: 200 } }, ['siteUrl','startDate','endDate']), annotations: readOnly
  },
  {
    name: 'schema_inspect', title: 'Inspect JSON-LD', description: 'Fetches one public page and parses application/ld+json blocks for JSON validity and discovered @type values.',
    inputSchema: obj({ url: siteUrl }, ['url']), annotations: readOnly
  },
  {
    name: 'site_health_check', title: 'Technical SEO health check', description: 'Read-only combined check of homepage metadata, robots.txt, sitemap.xml, Google/Bing sitemap status, Bing crawl issues and optional PageSpeed.',
    inputSchema: obj({ siteUrl, pageUrl: siteUrl, includePageSpeed: { type: 'boolean' }, strategy: { type: 'string', enum: ['mobile','desktop'] } }, ['siteUrl']), annotations: readOnly
  },
  {
    name: 'indexing_submit', title: 'Submit URLs to indexing services', description: 'Writes URL notifications to Google Indexing API, Bing URL Submission, or IndexNow. Google officially restricts its Indexing API to JobPosting and BroadcastEvent-in-VideoObject pages; ordinary blog pages may be rejected or ignored.',
    inputSchema: obj({
      method: { type: 'string', enum: ['google','bing','indexnow'] },
      siteUrl,
      urls: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 2048 }, minItems: 1, maxItems: 1000, uniqueItems: true },
      action: { type: 'string', enum: ['updated','deleted'] }
    }, ['method','urls']),
    annotations: writeAction
  },
  {
    name: 'indexing_status', title: 'Indexing submission status', description: 'Reads Google Indexing notification metadata, Bing URL submission quota, or verifies the IndexNow root key file. siteUrl is required; Google status also requires urls.',
    inputSchema: obj({
      method: { type: 'string', enum: ['google','bing','indexnow'] },
      siteUrl,
      urls: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 2048 }, minItems: 1, maxItems: 20, uniqueItems: true }
    }, ['method','siteUrl']),
    annotations: readOnly
  }
];

function byName(name) { return TOOLS.find(t => t.name === name); }

async function safe(label, fn) {
  try { return { ok: true, data: await fn() }; }
  catch (e) { return { ok: false, error: `${label}: ${e.message}` }; }
}

function summarizeGoogle(rows = []) {
  return rows.reduce((acc, row) => { acc.clicks += Number(row.clicks || 0); acc.impressions += Number(row.impressions || 0); return acc; }, { clicks: 0, impressions: 0 });
}
function summarizeBing(rows = []) {
  return rows.reduce((acc, row) => { acc.clicks += Number(row.Clicks || 0); acc.impressions += Number(row.Impressions || 0); return acc; }, { clicks: 0, impressions: 0 });
}

export async function callTool(env, name, args = {}) {
  const tool = byName(name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  validate(tool.inputSchema, args);
  const selected = args.engine || 'all';

  if (name === 'connection_status') return {
    google: { configured: googleConfigured(env), auth: 'service_account', scope: 'webmasters.readonly' },
    bing: { configured: bingConfigured(env), auth: 'api_key' },
    pagespeed: { configured: pagespeedConfigured(env), auth: 'service_account_oauth', scope: 'openid' },
    indexing: {
      googleIndexing: { configured: googleConfigured(env), enabled: true },
      bingUrlSubmission: { configured: bingConfigured(env), enabled: true },
      indexNow: { configured: typeof env.INDEXNOW_KEY === 'string' && env.INDEXNOW_KEY.length >= 8, enabled: true }
    },
    writeToolsExposed: true
  };

  if (name === 'sites_list') {
    const out = {};
    if (selected !== 'bing') out.google = await safe('google', () => googleSites(env));
    if (selected !== 'google') out.bing = await safe('bing', () => bingSites(env));
    return out;
  }

  if (name === 'sitemaps_list') {
    const out = {};
    if (selected !== 'bing') out.google = await safe('google', () => googleSitemaps(env, args.siteUrl));
    if (selected !== 'google') out.bing = await safe('bing', () => bingSitemaps(env, args.siteUrl));
    return out;
  }

  if (name === 'analytics_query') {
    const out = {};
    if (selected !== 'bing') out.google = await safe('google', () => googleAnalytics(env, args));
    if (selected !== 'google') out.bing = await safe('bing', () => bingAnalytics(env, args));
    return out;
  }

  if (name === 'inspection_inspect') {
    const out = {};
    if (selected !== 'bing') out.google = await safe('google', () => googleInspect(env, args.siteUrl, args.urls));
    if (selected !== 'google') out.bing = await safe('bing', () => bingInspect(env, args.siteUrl, args.urls));
    return out;
  }

  if (name === 'bing_crawl_issues') return bingCrawlIssues(env, args.siteUrl);
  if (name === 'pagespeed_analyze') return pagespeedAnalyze(env, args.url, args.strategy || 'mobile');

  if (name === 'analytics_compare') return analyticsCompare(env, args);
  if (name === 'analytics_anomalies') return analyticsAnomalies(env, args);
  if (name === 'seo_audit') return seoAudit(env, args);
  if (name === 'seo_keywords_research') return keywordResearch(env, args);
  if (name === 'genai_query_insights') return genaiQueryInsights(env, args);
  if (name === 'schema_inspect') return schemaInspect(args.url);
  if (name === 'site_health_check') return siteHealthCheck(env, args);
  if (name === 'indexing_submit') return indexingSubmit(env, args);
  if (name === 'indexing_status') return indexingStatus(env, args);

  if (name === 'compare_engines') {
    const dimensions = [args.dimension || 'query'];
    const common = { ...args, dimensions, engine: undefined, rowLimit: args.rowLimit || 100 };
    const [google, bing] = await Promise.all([
      safe('google', async () => { const resolved = await resolveGoogleSite(env, args.siteUrl); const data = await googleAnalytics(env, { ...common, siteUrl: resolved }); return { ...data, totals: summarizeGoogle(data.rows) }; }),
      safe('bing', async () => { const resolved = await resolveBingSite(env, args.siteUrl); const data = await bingAnalytics(env, { ...common, siteUrl: resolved }); return { ...data, totals: summarizeBing(data.rows) }; })
    ]);
    return { site: args.siteUrl, period: { startDate: args.startDate, endDate: args.endDate }, dimension: dimensions[0], google, bing };
  }

  throw new Error(`Tool not implemented: ${name}`);
}
