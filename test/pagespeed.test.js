import test from 'node:test';
import assert from 'node:assert/strict';
import { pagespeedAuthMode, pagespeedConfigured } from '../src/pagespeed.js';

test('PageSpeed prefers the existing Google service account', () => {
  const env = {
    GOOGLE_SERVICE_ACCOUNT_JSON: '{"client_email":"x@example.com","private_key":"dummy"}',
    PAGESPEED_API_KEY: 'legacy-key'
  };
  assert.equal(pagespeedAuthMode(env), 'service_account_oauth');
  assert.equal(pagespeedConfigured(env), true);
});

test('PageSpeed keeps API key as a fallback', () => {
  assert.equal(pagespeedAuthMode({ PAGESPEED_API_KEY: 'legacy-key' }), 'api_key');
  assert.equal(pagespeedConfigured({ PAGESPEED_API_KEY: 'legacy-key' }), true);
});

test('PageSpeed reports anonymous mode when no credential exists', () => {
  assert.equal(pagespeedAuthMode({}), 'anonymous');
  assert.equal(pagespeedConfigured({}), false);
});
