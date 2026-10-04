# claude-app-mirror Cloudflare dispatcher

Cloudflare Cron Trigger 主调度实例：每 15 分钟 dispatch `MaxQian888/claude-app-mirror` 的 `mirror.yml`
（GitHub Actions `schedule` 仍作为每 6 小时的低频兜底）。

**Worker 源码在 [Wangnov/agents-mirror-kit](https://github.com/Wangnov/agents-mirror-kit)
的 `workers/github-dispatcher/`**；本目录只保留这个实例的部署配置
`wrangler.jsonc`（实例名、cron、`DISPATCH_TARGETS`）。

## Deploy

```bash
git clone --depth 1 --branch v0.1.0 https://github.com/Wangnov/agents-mirror-kit
cp cloudflare/github-dispatcher/wrangler.jsonc agents-mirror-kit/workers/github-dispatcher/
cd agents-mirror-kit/workers/github-dispatcher
npx wrangler deploy
npx wrangler secret put GITHUB_TOKEN   # 首次部署或换 token 时
```

## Schedule

- Cloudflare 主调度：`7,22,37,52 * * * *`（UTC，每 15 分钟）
- GitHub 兜底：`11 */6 * * *`（UTC，每 6 小时）

## Credentials

Create a fine-grained GitHub token restricted to `MaxQian888/claude-app-mirror`
with repository **Actions: read and write** permission, and store it as the
Worker's `GITHUB_TOKEN` secret. Do not use a personal token with access to all
repositories. Renew it before its configured expiration.

The download hostname is served separately by
[`cognia-mirror`](../download-worker/README.md); this dispatcher has no public
HTTP endpoint.
