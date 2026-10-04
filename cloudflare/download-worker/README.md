# Cognia download Worker

Serves `https://mirror.cognia.cn` from the private `claude-app-mirror` R2 bucket.
This is separate from `../github-dispatcher`, which only schedules GitHub Actions.
The binding avoids public R2 credentials and exposes only these keys:

- `latest/mac`, `latest/win-x64`, `latest/win-arm64`
- `latest/checksums`, `latest/manifest`
- `stats/downloads.json`

Other keys, including upload staging and internal statistics, return 404. Missing
public objects also return 404. GET and HEAD are supported, with conditional
requests and single byte ranges for resumable downloads. Multiple or malformed
ranges are ignored; valid unsatisfiable ranges return 416. Installers are streamed
directly from R2. `Cache-Control: no-store` prevents old `latest` objects from
being cached. Avoid zone Cache Rules that override this policy for the hostname.

## Test and deploy

Run from this directory:

```sh
npm ci
npm test
npm run deploy
```

Tests run against local Miniflare R2 and do not access the production bucket.
Wrangler must authenticate to the account in `wrangler.jsonc`, with Workers
deployment and zone permissions. Deployment registers the custom domain and its
DNS record; an existing conflicting DNS record must be resolved first. The R2
bucket must exist before deployment. Do not attach a public R2 custom domain to
the same hostname: the download Worker owns it.

Configure GitHub Actions `R2_PUBLIC_BASE_URL` as `https://mirror.cognia.cn` and
`R2_BUCKET_NAME` as `claude-app-mirror`. The Worker needs no API token secret at
runtime; its R2 binding supplies access. The GitHub dispatcher and statistics
workflow use separate credentials.

## Sources

- [Cloudflare R2 Workers API reference](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)
- [Worker custom domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
