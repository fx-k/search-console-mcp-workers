import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTunnelEnv, handleStdioLine } from '../src/runtime/stdio.js';

test('Tunnel runtime loads Google credentials from one file path', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'search-console-mcp-'));
  const file = path.join(dir, 'google.json');
  fs.writeFileSync(file, JSON.stringify({
    client_email: 'mcp@example.iam.gserviceaccount.com',
    private_key: 'dummy'
  }));
  try {
    const env = createTunnelEnv({
      GOOGLE_SERVICE_ACCOUNT_FILE: file,
      BING_API_KEY: 'bing-key',
      INDEXNOW_KEY: 'abcDEF12-3456'
    });
    assert.equal(JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON).client_email, 'mcp@example.iam.gserviceaccount.com');
    assert.equal(env.BING_API_KEY, 'bing-key');
    assert.equal(env.INDEXNOW_KEY, 'abcDEF12-3456');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('stdio line dispatcher uses the shared MCP core', async () => {
  const response = await handleStdioLine({}, JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-11-25' }
  }));
  assert.equal(response.result.serverInfo.name, 'search-console-mcp');
});

test('stdio line dispatcher returns JSON-RPC parse errors', async () => {
  const response = await handleStdioLine({}, '{bad json');
  assert.equal(response.error.code, -32700);
});
