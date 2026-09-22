import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBingDate } from '../src/bing.js';
import { validateDateRange } from '../src/validation.js';

test('normalizes Bing Microsoft JSON dates', () => {
  assert.equal(normalizeBingDate('/Date(1789948800000)/'), '2026-09-21');
});

test('rejects backwards date ranges', () => {
  assert.throws(() => validateDateRange('2026-09-22', '2026-09-21'), /不能晚于/);
});
