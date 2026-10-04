const PUBLIC_FILES = new Map([
  ['/latest/mac', ['latest/mac', 'Claude-mac-universal.dmg', 'application/octet-stream']],
  ['/latest/win-x64', ['latest/win-x64', 'Claude-win-x64.msix', 'application/octet-stream']],
  ['/latest/win-arm64', ['latest/win-arm64', 'Claude-win-arm64.msix', 'application/octet-stream']],
  ['/latest/checksums', ['latest/checksums', 'SHA256SUMS.txt', 'text/plain; charset=utf-8']],
  ['/latest/manifest', ['latest/manifest', 'release-manifest.json', 'application/json']],
  ['/stats/downloads.json', ['stats/downloads.json', null, 'application/json']],
]);

const HOME = `<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Claude Desktop · Cognia Mirror</title>
<style>body{max-width:42rem;margin:4rem auto;padding:0 1.5rem;font:18px/1.7 system-ui;color:#242424;background:#faf9f6}a{color:#155b90}li{margin:.7rem 0}</style>
<h1>Claude Desktop 下载镜像</h1><p>Unofficial mirror · 非官方镜像，由 Cognia 维护。</p>
<ul><li><a href="/latest/mac">macOS Universal</a></li>
<li><a href="/latest/win-x64">Windows x64</a></li>
<li><a href="/latest/win-arm64">Windows ARM64</a></li>
<li><a href="/latest/checksums">SHA-256 校验和 / Checksums</a></li>
<li><a href="/latest/manifest">版本信息 / Release manifest</a></li></ul>
<p><a href="https://github.com/MaxQian888/claude-app-mirror/releases/latest">GitHub Release</a> · <a href="https://claude.ai/download">官方下载 / Official download</a></p></html>`;

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
    const pathname = new URL(request.url).pathname;
    if (pathname === '/') return response(request, HOME, 200, { 'Content-Type': 'text/html; charset=utf-8' });
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
