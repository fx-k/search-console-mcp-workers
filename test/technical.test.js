import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectHtml } from '../src/core/technical.js';

test('inspectHtml reads core SEO metadata and JSON-LD types', () => {
  const html = '<!doctype html><html lang="zh-CN"><head>' +
    '<title>Example | Site</title>' +
    '<meta name="description" content="desc">' +
    '<link rel="canonical" href="https://example.com/post">' +
    '<script type="application/ld+json">{"@context":"https://schema.org","@type":"BlogPosting"}</script>' +
    '</head></html>';
  const result = inspectHtml(html);
  assert.equal(result.lang, 'zh-CN');
  assert.equal(result.title, 'Example | Site');
  assert.equal(result.description, 'desc');
  assert.equal(result.canonical, 'https://example.com/post');
  assert.deepEqual(result.jsonLd[0].types, ['BlogPosting']);
  assert.equal(result.jsonLd[0].validJson, true);
});

test('inspectHtml reports invalid JSON-LD instead of throwing', () => {
  const result = inspectHtml('<script type="application/ld+json">{bad}</script>');
  assert.equal(result.jsonLd[0].validJson, false);
});
