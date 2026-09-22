import test from 'node:test';
import assert from 'node:assert/strict';
import { handleMcp } from '../src/mcp.js';
import { TOOLS } from '../src/tools.js';

const expected = ['connection_status', 'sites_list', 'sitemaps_list', 'analytics_query', 'inspection_inspect', 'bing_crawl_issues', 'pagespeed_analyze', 'compare_engines'];

test('exposes read-only MVP tool set', () => {
  assert.deepEqual(TOOLS.map(x => x.name), expected);
  for (const tool of TOOLS) assert.equal(tool.annotations?.readOnlyHint, true);
});

test('MCP initialize and tools/list', async () => {
  const init = await handleMcp({}, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } });
  assert.equal(init.result.serverInfo.name, 'search-console-mcp-workers');
  const list = await handleMcp({}, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  assert.equal(list.result.tools.length, expected.length);
});
