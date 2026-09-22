import test from 'node:test';
import assert from 'node:assert/strict';
import { detectAnomalies } from '../src/intelligence.js';

test('detectAnomalies flags a clear daily outlier', () => {
  const rows = [
    { date: '2026-09-01', clicks: 10 },
    { date: '2026-09-02', clicks: 11 },
    { date: '2026-09-03', clicks: 9 },
    { date: '2026-09-04', clicks: 10 },
    { date: '2026-09-05', clicks: 60 }
  ];
  const result = detectAnomalies(rows, 'clicks', 1.8);
  assert.equal(result.length, 1);
  assert.equal(result[0].date, '2026-09-05');
});

test('detectAnomalies does not invent anomalies for a flat series', () => {
  assert.deepEqual(detectAnomalies([
    { date: '2026-09-01', impressions: 100 },
    { date: '2026-09-02', impressions: 100 },
    { date: '2026-09-03', impressions: 100 }
  ], 'impressions', 2.5), []);
});
