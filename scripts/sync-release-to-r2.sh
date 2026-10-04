#!/usr/bin/env bash
set -euo pipefail

# Shared by new releases and recovery runs. Publish the manifest last so a failed
# asset upload remains detectable by the next scheduled recovery check.
: "${R2_BUCKET_NAME:?R2_BUCKET_NAME is required}"
: "${R2_PUBLIC_BASE_URL:?R2_PUBLIC_BASE_URL is required}"
: "${R2_S3_ENDPOINT:?R2_S3_ENDPOINT is required}"
mac="dist/Claude-mac-universal.dmg"
win_x64="dist/Claude-win-x64.msix"
win_arm64="dist/Claude-win-arm64.msix"
for file in "$mac" "$win_x64" "$win_arm64" SHA256SUMS.txt release-manifest.json; do
  test -f "$file"
done

tmp_dir="$(mktemp -d)"
staging_prefix="staging/${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}"
cleanup_staging() {
  bash .mirror-kit/scripts/clear-r2-prefix.sh "$R2_BUCKET_NAME" "$staging_prefix" || true
  rm -rf "$tmp_dir"
}
trap cleanup_staging EXIT

upload_aliases() {
  local prefix="$1"
  bash .mirror-kit/scripts/sync-r2.sh --object "$R2_BUCKET_NAME" "$prefix/mac" "$mac" Claude-mac-universal.dmg
  bash .mirror-kit/scripts/sync-r2.sh --object "$R2_BUCKET_NAME" "$prefix/win-x64" "$win_x64" Claude-win-x64.msix
  bash .mirror-kit/scripts/sync-r2.sh --object "$R2_BUCKET_NAME" "$prefix/win-arm64" "$win_arm64" Claude-win-arm64.msix
  bash .mirror-kit/scripts/sync-r2.sh --object "$R2_BUCKET_NAME" "$prefix/checksums" SHA256SUMS.txt SHA256SUMS.txt
  bash .mirror-kit/scripts/sync-r2.sh --object "$R2_BUCKET_NAME" "$prefix/manifest" release-manifest.json release-manifest.json
}

upload_aliases "$staging_prefix"
aws s3 cp "s3://$R2_BUCKET_NAME/$staging_prefix/manifest" "$tmp_dir/staging-manifest.json" \
  --endpoint-url "$R2_S3_ENDPOINT" --region "${AWS_DEFAULT_REGION:-auto}" --no-progress
cmp release-manifest.json "$tmp_dir/staging-manifest.json"
upload_aliases latest
curl -fsSL --retry 5 --retry-delay 2 --retry-all-errors --connect-timeout 20 --max-time 120 \
  "$R2_PUBLIC_BASE_URL/latest/manifest?run=${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}" \
  -o "$tmp_dir/public-manifest.json"
cmp release-manifest.json "$tmp_dir/public-manifest.json"
