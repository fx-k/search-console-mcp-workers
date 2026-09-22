import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveBingSite } from '../src/core/bing.js';

test('resolveBingSite normalizes a verified-site URL without GetUserSites preflight', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('resolveBingSite should not call the network');
  };
  try {
    assert.equal(
      await resolveBingSite({}, 'https://keke.su/posts/example.html'),
      'https://keke.su/'
    );
    assert.equal(
      await resolveBingSite({}, 'sc-domain:keke.su'),
      'https://keke.su/'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
