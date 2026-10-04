#!/usr/bin/env bash
set -euo pipefail

# Restore immutable release assets without creating a duplicate GitHub release.
: "${RELEASE_TAG:?RELEASE_TAG is required}"
if [[ "$RELEASE_TAG" == -* || "$RELEASE_TAG" == *$'\n'* || "$RELEASE_TAG" == *$'\r'* ]]; then
  echo "Invalid release tag." >&2
  exit 1
fi
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
assets=(Claude-mac-universal.dmg Claude-win-x64.msix Claude-win-arm64.msix)
patterns=()
for asset in "${assets[@]}" SHA256SUMS.txt release-manifest.json; do
  patterns+=(-p "$asset")
done
gh release download "$RELEASE_TAG" "${patterns[@]}" -D "$tmp_dir" --clobber
# Restrict checksum file paths before sha256sum can read any local path.
python3 - "$tmp_dir/SHA256SUMS.txt" <<'CHECKSUMS'
import re
import sys
from pathlib import Path
expected = {"Claude-mac-universal.dmg", "Claude-win-x64.msix", "Claude-win-arm64.msix", "release-manifest.json"}
seen = set()
for line in Path(sys.argv[1]).read_text().splitlines():
    match = re.fullmatch(r"[0-9a-fA-F]{64} [ *](.+)", line)
    if not match or match[1] not in expected or match[1] in seen:
        sys.exit("Invalid or duplicate release checksum entry")
    seen.add(match[1])
if seen != expected:
    sys.exit("Release checksum file is incomplete")
CHECKSUMS
(cd "$tmp_dir" && sha256sum --check SHA256SUMS.txt)
# Cross-check manifest hashes against the checksum entries verified above.
for index in 0 1 2; do
  selectors=(.sources.macos.universal.sha256 .sources.windows.x64.sha256 .sources.windows.arm64.sha256)
  expected="$(jq -er "${selectors[$index]}" "$tmp_dir/release-manifest.json")"
  actual="$(awk -v asset="${assets[$index]}" '{name = $2; sub(/^\*/, "", name); if (name == asset) print tolower($1)}' "$tmp_dir/SHA256SUMS.txt")"
  if [[ "$actual" != "$expected" ]]; then
    echo "Manifest checksum mismatch: ${assets[$index]}" >&2
    exit 1
  fi
done
mkdir -p dist
for asset in "${assets[@]}"; do
  cp "$tmp_dir/$asset" "dist/$asset"
done
cp "$tmp_dir/SHA256SUMS.txt" "$tmp_dir/release-manifest.json" .
