#!/usr/bin/env bash
set -euo pipefail

# Determine whether an existing GitHub release needs restoring to the public R2
# mirror. Manual restores do not depend on the official update API being online.
manual="${RESYNC_R2:-false}"
tag=""
if [[ "$manual" == "true" && -n "${RELEASE_TAG:-}" ]]; then
  tag="$RELEASE_TAG"
else
  tag="$(gh release list --limit 1 --exclude-drafts --exclude-pre-releases --json tagName --jq '.[0].tagName // ""')"
fi

should_sync=false
if [[ -z "$tag" ]]; then
  if [[ "$manual" == "true" ]]; then
    echo "No existing GitHub release is available to restore." >&2
    exit 1
  fi
else
  # Tags are also workflow output values and positional CLI arguments.
  if [[ "$tag" == -* || "$tag" == *$'\n'* || "$tag" == *$'\r'* ]]; then
    echo "Invalid release tag." >&2
    exit 1
  fi
  tmp_dir="$(mktemp -d)"
  trap 'rm -rf "$tmp_dir"' EXIT
  # Do not turn a GitHub/auth failure into a silent no-op.
  gh release download "$tag" -p release-manifest.json -D "$tmp_dir" --clobber
  jq -e '.sources.macos.universal.sha256 and .sources.windows.x64.sha256 and .sources.windows.arm64.sha256' \
    "$tmp_dir/release-manifest.json" >/dev/null
  if [[ "$manual" == "true" ]]; then
    should_sync=true
  elif ! curl -fsSL --retry 2 --retry-delay 2 --connect-timeout 20 --max-time 120 \
    "${R2_PUBLIC_BASE_URL:?R2_PUBLIC_BASE_URL is required}/latest/manifest?check=${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}" \
    -o "$tmp_dir/public-manifest.json"; then
    should_sync=true
  elif ! cmp -s "$tmp_dir/release-manifest.json" "$tmp_dir/public-manifest.json"; then
    should_sync=true
  fi
fi

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  printf 'should_sync=%s\nsync_tag=%s\n' "$should_sync" "$tag" >> "$GITHUB_OUTPUT"
fi
printf 'should_sync=%s\nsync_tag=%s\n' "$should_sync" "$tag"
