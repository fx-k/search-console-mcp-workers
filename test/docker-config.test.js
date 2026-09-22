import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('Docker Tunnel uses split egress instead of a process-wide proxy', () => {
  const compose = fs.readFileSync('docker-compose.yml', 'utf8');

  assert.match(compose, /CONTROL_PLANE_HTTP_PROXY:\s*http:\/\/egress-proxy:18080/u);
  assert.match(compose, /SOCKS5_UPSTREAM/u);

  // Do not let generic proxy variables leak into the stdio child process.
  assert.doesNotMatch(compose, /^\s+HTTP_PROXY:/mu);
  assert.doesNotMatch(compose, /^\s+HTTPS_PROXY:/mu);
  assert.doesNotMatch(compose, /^\s+ALL_PROXY:/mu);
  assert.doesNotMatch(compose, /^\s+MCP_HTTP_PROXY:/mu);
});
