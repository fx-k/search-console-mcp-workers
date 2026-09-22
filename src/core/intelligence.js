import { googleAnalytics } from './google.js';
import { bingAnalytics, bingKeywordStats, bingRelatedKeywords } from './bing.js';

function n(value) {
  const out = Number(value);
  return Number.isFinite(out) ? out : 0;
}

function pct(current, previous) {
  return previous === 0 ? null : (current - previous) / previous;
}

function normalizeGoogle(rows = [], dimensions = []) {
  return rows.map(row => {
    const dims = {};
    (row.keys || []).forEach((value, index) => { dims[dimensions[index] || ('dimension' + index)] = value; });
    return { ...dims, clicks: n(row.clicks), impressions: n(row.impressions), ctr: n(row.ctr), position: n(row.position) };
  });
}

function normalizeBingDate(value) {
  if (!value) return null;
  const match = String(value).match(/^\/Date\((\d+)(?:[+-]\d+)?\)\/$/u);
  const date = match ? new Date(Number(match[1])) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function normalizeBing(rows = [], dimensions = []) {
  return rows.map(row => {
    const out = {
      clicks: n(row.Clicks),
      impressions: n(row.Impressions),
      ctr: n(row.CTR),
      position: n(row.AvgPosition)
    };
    if (dimensions.includes('date')) out.date = normalizeBingDate(row.Date);
    if (dimensions.includes('query')) out.query = String(row.Query || '');
    if (dimensions.includes('page')) out.page = String(row.Page || (dimensions.length === 1 ? row.Query || '' : ''));
    return out;
  });
}

function summarize(rows = []) {
  const clicks = rows.reduce((sum, row) => sum + n(row.clicks), 0);
  const impressions = rows.reduce((sum, row) => sum + n(row.impressions), 0);
  const weightedPosition = rows.reduce((sum, row) => sum + n(row.position) * n(row.impressions), 0);
  return {
    clicks,
    impressions,
    ctr: impressions ? clicks / impressions : 0,
    averagePosition: impressions ? weightedPosition / impressions : null
  };
}

async function normalizedAnalytics(env, engine, args) {
  const dimensions = args.dimensions || ['query'];
  if (engine === 'google') {
    const data = await googleAnalytics(env, args);
    return { siteUrl: data.siteUrl, rows: normalizeGoogle(data.rows, dimensions) };
  }
  if (engine === 'bing') {
    const data = await bingAnalytics(env, args);
    return { siteUrl: data.siteUrl, rows: normalizeBing(data.rows, dimensions), sourceMethod: data.sourceMethod };
  }
  throw new Error('Unsupported engine: ' + engine);
}

export async function analyticsCompare(env, args) {
  const engines = !args.engine || args.engine === 'all' ? ['google', 'bing'] : [args.engine];
  const dimensions = [args.dimension || 'date'];
  const result = {};
  for (const engine of engines) {
    try {
      const [current, previous] = await Promise.all([
        normalizedAnalytics(env, engine, {
          siteUrl: args.siteUrl,
          startDate: args.currentStartDate,
          endDate: args.currentEndDate,
          dimensions,
          rowLimit: args.rowLimit || 1000
        }),
        normalizedAnalytics(env, engine, {
          siteUrl: args.siteUrl,
          startDate: args.previousStartDate,
          endDate: args.previousEndDate,
          dimensions,
          rowLimit: args.rowLimit || 1000
        })
      ]);
      const c = summarize(current.rows);
      const p = summarize(previous.rows);
      result[engine] = {
        ok: true,
        current: c,
        previous: p,
        delta: {
          clicks: pct(c.clicks, p.clicks),
          impressions: pct(c.impressions, p.impressions),
          ctr: c.ctr - p.ctr,
          averagePosition: c.averagePosition === null || p.averagePosition === null ? null : c.averagePosition - p.averagePosition
        },
        rows: { current: current.rows, previous: previous.rows }
      };
    } catch (error) {
      result[engine] = { ok: false, error: error.message };
    }
  }
  return {
    siteUrl: args.siteUrl,
    dimension: dimensions[0],
    periods: {
      current: [args.currentStartDate, args.currentEndDate],
      previous: [args.previousStartDate, args.previousEndDate]
    },
    engines: result
  };
}

export function detectAnomalies(rows, metric = 'clicks', threshold = 2.5) {
  const values = rows
    .filter(row => row.date && Number.isFinite(Number(row[metric])))
    .map(row => ({ date: row.date, value: Number(row[metric]) }));
  if (values.length < 3) return [];
  const mean = values.reduce((sum, row) => sum + row.value, 0) / values.length;
  const variance = values.reduce((sum, row) => sum + (row.value - mean) ** 2, 0) / values.length;
  const stddev = Math.sqrt(variance);
  if (!stddev) return [];
  return values
    .map(row => ({ ...row, zScore: (row.value - mean) / stddev }))
    .filter(row => Math.abs(row.zScore) >= threshold)
    .sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore));
}

export async function analyticsAnomalies(env, args) {
  const engines = !args.engine || args.engine === 'all' ? ['google', 'bing'] : [args.engine];
  const result = {};
  for (const engine of engines) {
    try {
      const data = await normalizedAnalytics(env, engine, {
        siteUrl: args.siteUrl,
        startDate: args.startDate,
        endDate: args.endDate,
        dimensions: ['date'],
        rowLimit: 1000
      });
      result[engine] = {
        ok: true,
        points: data.rows,
        anomalies: detectAnomalies(data.rows, args.metric || 'clicks', args.threshold || 2.5)
      };
    } catch (error) {
      result[engine] = { ok: false, error: error.message };
    }
  }
  return { siteUrl: args.siteUrl, metric: args.metric || 'clicks', threshold: args.threshold || 2.5, engines: result };
}

function queryOf(row) {
  return String(row.query || '').trim();
}

export async function seoAudit(env, args) {
  const engine = args.engine || 'google';
  const dimensions = args.type === 'cannibalization' ? ['query', 'page'] : ['query'];
  const data = await normalizedAnalytics(env, engine, {
    siteUrl: args.siteUrl,
    startDate: args.startDate,
    endDate: args.endDate,
    dimensions,
    rowLimit: args.rowLimit || 1000
  });
  const minImpressions = args.minImpressions ?? 10;

  if (args.type === 'cannibalization') {
    const groups = new Map();
    for (const row of data.rows) {
      if (row.impressions < minImpressions || !queryOf(row) || !row.page) continue;
      const group = groups.get(queryOf(row)) || { query: queryOf(row), pages: new Map(), clicks: 0, impressions: 0 };
      const page = group.pages.get(row.page) || { page: row.page, clicks: 0, impressions: 0, weightedPosition: 0 };
      page.clicks += row.clicks;
      page.impressions += row.impressions;
      page.weightedPosition += row.position * row.impressions;
      group.pages.set(row.page, page);
      group.clicks += row.clicks;
      group.impressions += row.impressions;
      groups.set(group.query, group);
    }
    const items = [...groups.values()]
      .filter(group => group.pages.size >= 2)
      .map(group => ({
        query: group.query,
        clicks: group.clicks,
        impressions: group.impressions,
        pages: [...group.pages.values()].map(page => ({
          page: page.page,
          clicks: page.clicks,
          impressions: page.impressions,
          averagePosition: page.impressions ? page.weightedPosition / page.impressions : null
        })).sort((a, b) => b.impressions - a.impressions)
      }))
      .sort((a, b) => b.impressions - a.impressions);
    return { type: args.type, engine, siteUrl: data.siteUrl, items: items.slice(0, args.limit || 50) };
  }

  const maxCtr = args.maxCtr ?? 0.08;
  let items = data.rows.filter(row => row.impressions >= minImpressions && queryOf(row));
  if (args.type === 'striking_distance') items = items.filter(row => row.position >= 8 && row.position <= 15);
  else if (args.type === 'quick_wins') items = items.filter(row => row.position >= 4 && row.position <= 15 && row.ctr <= maxCtr);
  else if (args.type === 'low_ctr') items = items.filter(row => row.position <= 10 && row.ctr <= maxCtr);
  else throw new Error('Unsupported seo_audit type: ' + args.type);

  items.sort((a, b) => b.impressions - a.impressions);
  return {
    type: args.type,
    engine,
    siteUrl: data.siteUrl,
    criteria: { minImpressions, maxCtr },
    items: items.slice(0, args.limit || 50)
  };
}

const GENAI_PATTERNS = [
  /\b(how|what|why|when|where|which|can|could|should|would|is it|are there|help me|explain|compare)\b/iu,
  /(如何|怎么|为什么|什么|哪里|哪个|能否|可以|是否|有没有|帮我|解释|比较|区别)/u
];

function conversational(query) {
  return GENAI_PATTERNS.some(pattern => pattern.test(query)) || query.trim().split(/\s+/u).length >= 7;
}

export async function genaiQueryInsights(env, args) {
  const engines = !args.engine || args.engine === 'all' ? ['google', 'bing'] : [args.engine];
  const result = {};
  for (const engine of engines) {
    try {
      const data = await normalizedAnalytics(env, engine, {
        siteUrl: args.siteUrl,
        startDate: args.startDate,
        endDate: args.endDate,
        dimensions: ['query'],
        rowLimit: args.rowLimit || 1000
      });
      const items = data.rows
        .filter(row => row.impressions >= (args.minImpressions ?? 1) && conversational(queryOf(row)))
        .map(row => ({ query: queryOf(row), clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position }))
        .sort((a, b) => b.impressions - a.impressions);
      result[engine] = {
        ok: true,
        items: items.slice(0, args.limit || 100),
        note: 'Heuristic only. Google and Bing do not expose an official GenAI-citation query flag in these APIs.'
      };
    } catch (error) {
      result[engine] = { ok: false, error: error.message };
    }
  }
  return { siteUrl: args.siteUrl, engines: result };
}

export async function keywordResearch(env, args) {
  if (args.type === 'stats') return { type: 'stats', rows: await bingKeywordStats(env, args.keyword, args.country, args.language) };
  if (args.type === 'related') return { type: 'related', rows: await bingRelatedKeywords(env, args.keyword, args.country, args.language) };
  throw new Error('Unsupported keyword research type: ' + args.type);
}
