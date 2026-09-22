import { validate } from './validation.js';
import { googleSites, googleSitemaps, googleAnalytics, googleInspect, googleConfigured, resolveGoogleSite } from './google.js';
import { bingSites, bingSitemaps, bingAnalytics, bingInspect, bingCrawlIssues, bingConfigured, resolveBingSite } from './bing.js';
import { pagespeedAnalyze, pagespeedConfigured } from './pagespeed.js';

export const VERSION = '0.1.0';
const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
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
  { name: 'compare_engines', title: 'Compare Google and Bing', description: 'Fetches query or page search performance from Google and Bing in parallel for the same site and period.', inputSchema: obj({ siteUrl, startDate: date, endDate: date, dimension: { type: 'string', enum: ['query', 'page'] }, rowLimit: { type: 'integer', minimum: 1, maximum: 500 } }, ['siteUrl', 'startDate', 'endDate']), annotations: readOnly }
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
    pagespeed: { configuredApiKey: pagespeedConfigured(env), note: 'API key is optional but recommended for quota stability' },
    writeToolsExposed: false
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
