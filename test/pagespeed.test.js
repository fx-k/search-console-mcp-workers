import test from 'node:test';
import assert from 'node:assert/strict';
import { pagespeedConfigured } from '../src/core/pagespeed.js';

test('PageSpeed is configured only by the existing Google service account', () => {
  const env = {
    GOOGLE_SERVICE_ACCOUNT_JSON: '{"client_email":"x@example.com","private_key":"dummy"}'
  };
  assert.equal(pagespeedConfigured(env), true);
});

test('PageSpeed is not configured without the Google service account', () => {
  assert.equal(pagespeedConfigured({}), false);
});
