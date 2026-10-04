import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import worker from './worker.mjs';

let runtime;
let bucket;
const fetch = (path, options) => runtime.dispatchFetch(`https://mirror.cognia.cn${path}`, options);

before(async () => {
  runtime = new Miniflare(convertV4MiniflareOptions({
    workers: [{
      name: 'mirror',
      modules: true,
      script: await readFile(new URL('./worker.mjs', import.meta.url), 'utf8'),
      compatibilityDate: '2026-10-04',
      r2Buckets: ['MIRROR_BUCKET'],
    }],
  }));
  bucket = await runtime.getR2Bucket('MIRROR_BUCKET');
  await bucket.put('latest/mac', '0123456789', {
    httpMetadata: {
      contentType: 'application/x-apple-diskimage',
      contentDisposition: 'attachment; filename="Claude-1.0.dmg"',
      cacheControl: 'public, max-age=31536000',
    },
  });
  await bucket.put('latest/manifest', '{"version":"1"}');
  await bucket.put('stats/downloads.json', '{"total":10}');
  await bucket.put('staging/private', 'private');
  await bucket.put('stats/internal.json', 'private');
});
after(async () => runtime?.dispose());

test('GET streams the object with attachment, validators and no stale caching', async () => {
  const result = await fetch('/latest/mac');
  assert.equal(result.status, 200);
  assert.equal(await result.text(), '0123456789');
  assert.equal(result.headers.get('Content-Length'), '10');
  assert.equal(result.headers.get('Content-Type'), 'application/x-apple-diskimage');
  assert.equal(result.headers.get('Content-Disposition'), 'attachment; filename="Claude-1.0.dmg"');
  assert.equal(result.headers.get('Cache-Control'), 'no-store');
  assert.match(result.headers.get('ETag'), /^".+"$/);
  assert.ok(result.headers.get('Last-Modified'));
});

test('missing R2 metadata uses public file defaults', async () => {
  const result = await fetch('/latest/manifest');
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('Content-Type'), 'application/json');
  assert.equal(result.headers.get('Content-Disposition'), 'attachment; filename="release-manifest.json"');
  await result.text();
});

test('HEAD carries the full metadata and ignores Range', async () => {
  const result = await fetch('/latest/mac', { method: 'HEAD', headers: { Range: 'bytes=1-2' } });
  assert.equal(result.status, 200);
  assert.equal(await result.text(), '');
  assert.equal(result.headers.get('Content-Length'), '10');
  assert.equal(result.headers.get('Content-Range'), null);
});

test('single byte, open ended, suffix and clamped ranges', async () => {
  for (const [range, body, contentRange] of [
    ['bytes=0-0', '0', 'bytes 0-0/10'],
    ['bytes=2-5', '2345', 'bytes 2-5/10'],
    ['bytes=7-', '789', 'bytes 7-9/10'],
    ['bytes=-3', '789', 'bytes 7-9/10'],
    ['bytes=8-99', '89', 'bytes 8-9/10'],
    ['bytes=-99', '0123456789', 'bytes 0-9/10'],
  ]) {
    const result = await fetch('/latest/mac', { headers: { Range: range } });
    assert.equal(result.status, 206, range);
    assert.equal(await result.text(), body, range);
    assert.equal(result.headers.get('Content-Range'), contentRange);
    assert.equal(result.headers.get('Content-Length'), String(body.length));
  }
});

test('unsatisfiable ranges yield 416 while invalid or multiple ranges yield full content', async () => {
  for (const range of ['bytes=10-', 'bytes=-0']) {
    const result = await fetch('/latest/mac', { headers: { Range: range } });
    assert.equal(result.status, 416);
    assert.equal(result.headers.get('Content-Range'), 'bytes */10');
  }
  for (const range of ['bytes=5-2', 'bytes=0-1,4-5', 'items=0-1', 'bytes=-', 'bytes=999999999999999999999-']) {
    const result = await fetch('/latest/mac', { headers: { Range: range } });
    assert.equal(result.status, 200, range);
    assert.equal(await result.text(), '0123456789');
  }
});

test('If-Range allows only a matching strong ETag or current date', async () => {
  const metadata = await fetch('/latest/mac', { method: 'HEAD' });
  const etag = metadata.headers.get('ETag');
  const date = metadata.headers.get('Last-Modified');
  for (const [value, status] of [[etag, 206], [date, 206], [`W/${etag}`, 200], ['"old"', 200], ['Sun, 01 Jan 2000 00:00:00 GMT', 200], ['Tue, 01 Jan 2030 00:00:00 GMT', 200], ['invalid', 200]]) {
    const result = await fetch('/latest/mac', { headers: { Range: 'bytes=1-2', 'If-Range': value } });
    assert.equal(result.status, status, value);
    assert.equal(await result.text(), status === 206 ? '12' : '0123456789');
  }
});

test('conditional requests preserve validator precedence', async () => {
  const metadata = await fetch('/latest/mac', { method: 'HEAD' });
  const etag = metadata.headers.get('ETag');
  const date = metadata.headers.get('Last-Modified');
  const cases = [
    [{ 'If-None-Match': `"other", W/${etag}` }, 304],
    [{ 'If-None-Match': '*' }, 304],
    [{ 'If-Modified-Since': date }, 304],
    [{ 'If-None-Match': '"other"', 'If-Modified-Since': date }, 200],
    [{ 'If-Match': '"other"' }, 412],
    [{ 'If-Match': `W/${etag}` }, 412],
    [{ 'If-Match': etag, 'If-Unmodified-Since': 'Sun, 01 Jan 2000 00:00:00 GMT' }, 200],
    [{ 'If-Unmodified-Since': 'Sun, 01 Jan 2000 00:00:00 GMT' }, 412],
  ];
  for (const [headers, expected] of cases) {
    const result = await fetch('/latest/mac', { headers });
    assert.equal(result.status, expected, JSON.stringify(headers));
    if (expected === 304 || expected === 412) assert.equal(await result.text(), '');
    else await result.arrayBuffer();
  }
});

test('explicit public keys only, missing objects and unsupported methods', async () => {
  for (const path of ['/staging/private', '/stats/internal.json', '/latest/unknown', '/latest/win-arm64', '/latest%2Fmac']) {
    const result = await fetch(path);
    assert.equal(result.status, 404, path);
  }
  const stats = await fetch('/stats/downloads.json');
  assert.equal(stats.status, 200);
  assert.equal(stats.headers.get('Content-Type'), 'application/json');
  assert.deepEqual(await stats.json(), { total: 10 });
  const result = await fetch('/latest/mac', { method: 'POST' });
  assert.equal(result.status, 405);
  assert.equal(result.headers.get('Allow'), 'GET, HEAD');
});

test('homepage links to this mirror and the owned release', async () => {
  const result = await fetch('/');
  assert.equal(result.status, 200);
  assert.match(await result.text(), /MaxQian888\/claude-app-mirror\/releases\/latest/);
});

test('latest reads see a replacement immediately', async () => {
  const before = await fetch('/latest/manifest');
  const etag = before.headers.get('ETag');
  await before.text();
  await bucket.put('latest/manifest', '{"version":"2"}');
  const result = await fetch('/latest/manifest', { headers: { 'If-None-Match': etag } });
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { version: '2' });
});

test('an object replaced during GET is retried without mixing old range metadata', async () => {
  let gets = 0;
  const unstableBucket = {
    head: (...args) => bucket.head(...args),
    async get(...args) {
      if (gets++ === 0) await bucket.put('latest/mac', 'abcdefghijklmno');
      return bucket.get(...args);
    },
  };
  const result = await worker.fetch(new Request('https://mirror.cognia.cn/latest/mac', { headers: { Range: 'bytes=8-' } }), { MIRROR_BUCKET: unstableBucket });
  assert.equal(result.status, 206);
  assert.equal(result.headers.get('Content-Range'), 'bytes 8-14/15');
  assert.equal(await result.text(), 'ijklmno');
  assert.equal(gets, 2);
});

test('R2 errors and continuous replacement return a retryable response', async () => {
  const request = new Request('https://mirror.cognia.cn/latest/mac');
  const changed = await worker.fetch(request, {
    MIRROR_BUCKET: { head: (...args) => bucket.head(...args), get: (...args) => bucket.head(args[0]) },
  });
  assert.equal(changed.status, 503);
  assert.equal(changed.headers.get('Retry-After'), '2');
  const failed = await worker.fetch(request, { MIRROR_BUCKET: { head: async () => { throw new Error('test R2 unavailable'); } } });
  assert.equal(failed.status, 503);
  assert.equal(failed.headers.get('Retry-After'), '30');
});
