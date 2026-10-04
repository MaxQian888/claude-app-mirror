import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderHomepage } from './homepage.mjs';

test('manifest values cannot inject HTML or change download destinations', () => {
  const attack = '"><script>alert(1)</script>&';
  const html = renderHomepage({
    version: attack, generatedAt: attack,
    sources: { macos: { universal: { version: attack, contentLength: attack, url: 'https://untrusted.invalid' } } },
  });
  assert.ok(!html.includes(attack));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;&amp;'));
  assert.ok(!html.includes('href="https://untrusted.invalid'));
  assert.ok(!html.includes('Invalid Date'));
  for (const alias of ['mac', 'win-x64', 'win-arm64', 'checksums', 'manifest']) {
    assert.ok(html.includes(`href="/latest/${alias}"`));
  }
});

test('metadata fallback is complete in both locales and locale input is constrained', () => {
  for (const [locale, expected, title] of [['en', 'en', 'Choose your platform'], ['zh-CN', 'zh-CN', '选择你的平台'], ['<script>', 'zh-CN', '选择你的平台']]) {
    const html = renderHomepage(null, locale);
    assert.ok(html.includes(`<html lang="${expected}">`));
    assert.ok(html.includes(title));
    assert.ok(!html.includes('undefined'));
    assert.ok(!html.includes('null'));
    assert.ok(html.includes('https://claude.ai/download'));
    assert.ok(html.includes('href="#downloads"'));
    assert.ok(html.includes('<details>'));
  }
});

test('sizes and timestamps are formatted from the manifest, not a fixed release', () => {
  const html = renderHomepage({
    version: '9.0', generatedAt: '2026-10-04T01:00:00Z',
    sources: { macos: { universal: { version: '9.1', contentLength: 377037896 } } },
  }, 'en');
  assert.ok(html.includes('v9.0'));
  assert.ok(html.includes('v9.1'));
  assert.ok(html.includes('377 MB'));
  assert.ok(html.includes('Oct 4, 2026'));
  assert.ok(!html.includes('NaN'));
  assert.ok(!html.includes('2.19675.0'));
});
