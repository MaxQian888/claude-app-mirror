import { renderHomepage } from './homepage.mjs';

const PUBLIC_FILES = new Map([
  ['/latest/mac', ['latest/mac', 'Claude-mac-universal.dmg', 'application/octet-stream']],
  ['/latest/win-x64', ['latest/win-x64', 'Claude-win-x64.msix', 'application/octet-stream']],
  ['/latest/win-arm64', ['latest/win-arm64', 'Claude-win-arm64.msix', 'application/octet-stream']],
  ['/latest/checksums', ['latest/checksums', 'SHA256SUMS.txt', 'text/plain; charset=utf-8']],
  ['/latest/manifest', ['latest/manifest', 'release-manifest.json', 'application/json']],
  ['/stats/downloads.json', ['stats/downloads.json', null, 'application/json']],
]);

function response(request, body, status, headers = {}) {
  return new Response(request.method === 'HEAD' ? null : body, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
  });
}

function etagMatches(value, etag, weak = false) {
  return value.split(',').some((tag) => {
    tag = tag.trim();
    return tag === '*' || (weak ? tag.replace(/^W\//, '') : tag) === etag;
  });
}

function preconditionStatus(request, object) {
  const headers = request.headers;
  const modified = Math.floor(object.uploaded.getTime() / 1000) * 1000;
  const match = headers.get('If-Match');
  if (match !== null && !etagMatches(match, object.httpEtag)) return 412;
  const unmodified = headers.get('If-Unmodified-Since');
  if (match === null && unmodified && modified > Date.parse(unmodified)) return 412;
  const noneMatch = headers.get('If-None-Match');
  if (noneMatch !== null && etagMatches(noneMatch, object.httpEtag, true)) return 304;
  const since = headers.get('If-Modified-Since');
  if (noneMatch === null && since && modified <= Date.parse(since)) return 304;
  return null;
}

// Invalid/multiple ranges are ignored; a valid but unsatisfiable range yields 416.
function parseRange(value, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value || '');
  if (!match || (!match[1] && !match[2])) return null;
  if (!size) return false;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix)) return null;
    if (suffix === 0) return false;
    const length = Math.min(suffix, size);
    return { offset: size - length, length };
  }
  const offset = Number(match[1]);
  const end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end)) return null;
  if (match[2] && end < offset) return null;
  if (offset >= size) return false;
  return { offset, length: Math.min(end, size - 1) - offset + 1 };
}

function ifRangeMatches(value, object) {
  if (!value) return true;
  if (value.startsWith('"') || value.startsWith('W/')) return value === object.httpEtag;
  return Math.floor(object.uploaded.getTime() / 1000) * 1000 === Date.parse(value);
}

function objectHeaders(object, filename, contentType) {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', contentType);
  if (filename && !headers.has('Content-Disposition')) {
    headers.set('Content-Disposition', `attachment; filename="${filename}"`);
  }
  headers.set('Cache-Control', 'no-store');
  headers.delete('Expires');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('ETag', object.httpEtag);
  headers.set('Last-Modified', object.uploaded.toUTCString());
  headers.set('Accept-Ranges', 'bytes');
  return headers;
}

async function download(request, bucket, file) {
  const [key, filename, contentType] = file;
  // A latest object may be replaced between HEAD and GET. Pin the body to the
  // inspected ETag and retry once so range/length headers never describe old bytes.
  for (let attempt = 0; attempt < 2; attempt++) {
    const metadata = await bucket.head(key);
    if (!metadata) return response(request, 'Not found', 404);
    const headers = objectHeaders(metadata, filename, contentType);
    const status = preconditionStatus(request, metadata);
    if (status) return new Response(null, { status, headers });
    if (request.method === 'HEAD') {
      headers.set('Content-Length', String(metadata.size));
      return new Response(null, { headers });
    }
    const range = ifRangeMatches(request.headers.get('If-Range'), metadata)
      ? parseRange(request.headers.get('Range'), metadata.size)
      : null;
    if (range === false) {
      headers.set('Content-Range', `bytes */${metadata.size}`);
      return new Response(null, { status: 416, headers });
    }
    const object = await bucket.get(key, {
      onlyIf: { etagMatches: metadata.etag },
      ...(range ? { range } : {}),
    });
    if (!object || !object.body) continue;
    if (object.version !== metadata.version) {
      await object.body.cancel();
      continue;
    }
    const currentHeaders = objectHeaders(object, filename, contentType);
    currentHeaders.set('Content-Length', String(range ? range.length : object.size));
    if (range) currentHeaders.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`);
    return new Response(object.body, { status: range ? 206 : 200, headers: currentHeaders });
  }
  return response(request, 'Mirror is updating; please retry.', 503, { 'Retry-After': '2' });
}

export default {
  async fetch(request, env) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return response(request, 'Method not allowed', 405, { Allow: 'GET, HEAD' });
    }
    const url = new URL(request.url);
    const pathname = url.pathname;
    if (pathname === '/') {
      const locale = url.searchParams.get('lang') === 'en' ? 'en' : 'zh-CN';
      const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Content-Language': locale };
      if (request.method === 'HEAD') return response(request, null, 200, headers);
      let manifest = null;
      try {
        const object = await env.MIRROR_BUCKET.get('latest/manifest');
        if (object) {
          if (object.size > 64 * 1024) {
            await object.body.cancel();
            console.warn('Homepage manifest exceeds size limit');
          } else {
            manifest = await object.json();
          }
        }
      } catch {
        console.warn('Homepage manifest unavailable');
      }
      return response(request, renderHomepage(manifest, locale), 200, headers);
    }
    const file = PUBLIC_FILES.get(pathname);
    if (!file) return response(request, 'Not found', 404);
    try {
      return await download(request, env.MIRROR_BUCKET, file);
    } catch (error) {
      console.error('Mirror R2 read failed', error);
      return response(request, 'Mirror temporarily unavailable.', 503, { 'Retry-After': '30' });
    }
  },
};
