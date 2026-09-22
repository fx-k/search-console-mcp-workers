import test from 'node:test';
import assert from 'node:assert/strict';
import { indexNowSubmit, indexNowStatus, googleIndexingSubmit } from '../src/core/indexing.js';

test('IndexNow submits same-host URLs with the configured key', async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url: String(url), options };
    return new Response('', { status: 200 });
  };
  try {
    const result = await indexNowSubmit(
      { INDEXNOW_KEY: 'abcDEF12-3456' },
      ['https://example.com/a', 'https://example.com/b']
    );
    assert.equal(result.ok, true);
    assert.equal(result.submitted, 2);
    assert.equal(result.keyLocation, 'https://example.com/abcDEF12-3456.txt');
    assert.equal(captured.url, 'https://api.indexnow.org/indexnow');
    const body = JSON.parse(captured.options.body);
    assert.equal(body.host, 'example.com');
    assert.deepEqual(body.urlList, ['https://example.com/a', 'https://example.com/b']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('IndexNow rejects mixed hosts', async () => {
  await assert.rejects(
    () => indexNowSubmit(
      { INDEXNOW_KEY: 'abcDEF12-3456' },
      ['https://example.com/a', 'https://other.example/b']
    ),
    /必须属于主机/
  );
});

test('Google Indexing reports missing service-account configuration before network calls', async () => {
  await assert.rejects(
    () => googleIndexingSubmit({}, ['https://example.com/a'], 'updated'),
    /未配置 GOOGLE_SERVICE_ACCOUNT_JSON/
  );
});

test('IndexNow status verifies the root key file from siteUrl', async () => {
  const originalFetch = globalThis.fetch;
  let requested;
  globalThis.fetch = async url => {
    requested = String(url);
    return new Response('abcDEF12-3456\n', { status: 200 });
  };
  try {
    const result = await indexNowStatus(
      { INDEXNOW_KEY: 'abcDEF12-3456' },
      'https://example.com/'
    );
    assert.equal(requested, 'https://example.com/abcDEF12-3456.txt');
    assert.equal(result.verificationFetchStatus, 200);
    assert.equal(result.verificationMatches, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
