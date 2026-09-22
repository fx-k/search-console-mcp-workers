import { normalizeHttpUrl } from './validation.js';

export async function pagespeedAnalyze(env, inputUrl, strategy = 'mobile') {
  const target = normalizeHttpUrl(inputUrl);
  const url = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
  url.searchParams.set('url', target);
  url.searchParams.set('strategy', strategy);
  url.searchParams.append('category', 'performance');
  if (env.PAGESPEED_API_KEY) url.searchParams.set('key', env.PAGESPEED_API_KEY);
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`PageSpeed Insights API error (${response.status}): ${data?.error?.message || response.statusText}`);
  const lr = data.lighthouseResult || {};
  const audits = lr.audits || {};
  const pick = id => audits[id] ? { displayValue: audits[id].displayValue, numericValue: audits[id].numericValue, score: audits[id].score } : null;
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

export function pagespeedConfigured(env) { return typeof env.PAGESPEED_API_KEY === 'string' && env.PAGESPEED_API_KEY.length > 0; }
