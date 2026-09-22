import { googleSitemaps } from './google.js';
import { bingSitemaps, bingCrawlIssues } from './bing.js';
import { pagespeedAnalyze } from './pagespeed.js';

function rootUrl(siteInput) {
  const raw = String(siteInput);
  if (raw.startsWith('sc-domain:')) return 'https://' + raw.slice('sc-domain:'.length) + '/';
  const url = new URL(raw);
  return url.protocol + '//' + url.host + '/';
}

function assertPublicUrl(input) {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new Error('URL 必须是公开 http/https URL');
  }
  const host = url.hostname.toLowerCase();
  const blocked =
    ['localhost', '127.0.0.1', '::1'].includes(host) ||
    host.endsWith('.local') ||
    /^10\./u.test(host) ||
    /^192\.168\./u.test(host) ||
    /^169\.254\./u.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./u.test(host);
  if (blocked) throw new Error('不允许访问本地或私有网络地址');
  return url.href;
}

async function fetchText(input) {
  const response = await fetch(assertPublicUrl(input), {
    headers: { 'User-Agent': 'search-console-mcp-workers/0.2' },
    redirect: 'follow'
  });
  const text = (await response.text()).slice(0, 512 * 1024);
  return {
    url: response.url || input,
    status: response.status,
    ok: response.ok,
    contentType: response.headers.get('content-type') || '',
    text
  };
}

function first(html, regex) {
  return html.match(regex)?.[1]?.trim() || null;
}

function jsonLdBlocks(html) {
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/giu)]
    .map(match => match[1].trim());
  return scripts.map((raw, index) => {
    try {
      const value = JSON.parse(raw);
      const nodes = Array.isArray(value) ? value : value?.['@graph'] ? value['@graph'] : [value];
      const types = nodes.flatMap(node => Array.isArray(node?.['@type']) ? node['@type'] : node?.['@type'] ? [node['@type']] : []);
      return { index, validJson: true, types };
    } catch (error) {
      return { index, validJson: false, error: error.message };
    }
  });
}

export function inspectHtml(html) {
  return {
    lang: first(html, /<html[^>]+lang=["']([^"']+)["']/iu),
    title: first(html, /<title[^>]*>([\s\S]*?)<\/title>/iu),
    description:
      first(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>/iu) ||
      first(html, /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["'][^>]*>/iu),
    canonical:
      first(html, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["'][^>]*>/iu) ||
      first(html, /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["'][^>]*>/iu),
    robots: first(html, /<meta[^>]+name=["']robots["'][^>]+content=["']([^"']*)["'][^>]*>/iu),
    jsonLd: jsonLdBlocks(html)
  };
}

export async function schemaInspect(url) {
  const page = await fetchText(url);
  const metadata = inspectHtml(page.text);
  return {
    url: page.url,
    status: page.status,
    contentType: page.contentType,
    jsonLd: metadata.jsonLd,
    note: 'Checks JSON syntax and discovered @type values only; this is not a full Schema.org or rich-result validator.'
  };
}

export async function siteHealthCheck(env, args) {
  const root = rootUrl(args.siteUrl);
  const robotsUrl = new URL('/robots.txt', root).href;
  const sitemapUrl = new URL('/sitemap.xml', root).href;
  const [home, robots, sitemap, google, bing, crawl, speed] = await Promise.all([
    fetchText(args.pageUrl || root).catch(error => ({ ok: false, error: error.message })),
    fetchText(robotsUrl).catch(error => ({ ok: false, error: error.message })),
    fetchText(sitemapUrl).catch(error => ({ ok: false, error: error.message })),
    googleSitemaps(env, args.siteUrl).then(data => ({ ok: true, data })).catch(error => ({ ok: false, error: error.message })),
    bingSitemaps(env, args.siteUrl).then(data => ({ ok: true, data })).catch(error => ({ ok: false, error: error.message })),
    bingCrawlIssues(env, args.siteUrl).then(data => ({ ok: true, data })).catch(error => ({ ok: false, error: error.message })),
    args.includePageSpeed
      ? pagespeedAnalyze(env, args.pageUrl || root, args.strategy || 'mobile')
          .then(data => ({ ok: true, data }))
          .catch(error => ({ ok: false, error: error.message }))
      : Promise.resolve(null)
  ]);

  const homepage = home.text ? {
    status: home.status,
    contentType: home.contentType,
    ...inspectHtml(home.text)
  } : home;

  const robotsInfo = robots.text ? {
    status: robots.status,
    contentType: robots.contentType,
    sitemapDirectives: [...robots.text.matchAll(/^\s*Sitemap:\s*(\S+)/gimu)].map(match => match[1])
  } : robots;

  const sitemapInfo = sitemap.text ? {
    status: sitemap.status,
    contentType: sitemap.contentType,
    urlCount: (sitemap.text.match(/<url(?:\s|>)/giu) || []).length,
    sitemapCount: (sitemap.text.match(/<sitemap(?:\s|>)/giu) || []).length,
    xmlDeclaresUtf8: /^\s*<\?xml[^>]*encoding=["']UTF-8["']/iu.test(sitemap.text)
  } : sitemap;

  return {
    siteUrl: args.siteUrl,
    root,
    homepage,
    robots: robotsInfo,
    sitemap: sitemapInfo,
    searchConsoles: { google, bing },
    bingCrawlIssues: crawl,
    pageSpeed: speed
  };
}
