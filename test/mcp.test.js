import test from 'node:test';
import assert from 'node:assert/strict';
import { handleMcp } from '../src/mcp.js';
import { TOOLS } from '../src/tools.js';

const expected = [
  'connection_status', 'sites_list', 'sitemaps_list', 'analytics_query',
  'inspection_inspect', 'bing_crawl_issues', 'pagespeed_analyze', 'compare_engines',
  'analytics_compare', 'analytics_anomalies', 'seo_audit', 'seo_keywords_research',
  'genai_query_insights', 'schema_inspect', 'site_health_check',
  'indexing_submit', 'indexing_status'
];

test('exposes SEO reads plus indexing submission tools', () => {
  assert.deepEqual(TOOLS.map(x => x.name), expected);
  const submit = TOOLS.find(x => x.name === 'indexing_submit');
  assert.equal(submit.annotations?.readOnlyHint, false);
  assert.equal(submit.annotations?.destructiveHint, true);
  for (const tool of TOOLS.filter(x => x.name !== 'indexing_submit')) {
    assert.equal(tool.annotations?.readOnlyHint, true);
  }
});

test('MCP initialize and tools/list', async () => {
  const init = await handleMcp({}, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } });
  assert.equal(init.result.serverInfo.name, 'search-console-mcp-workers');
  const list = await handleMcp({}, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  assert.equal(list.result.tools.length, expected.length);
});
