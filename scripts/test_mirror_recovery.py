"""Exercise recovery and publishing decisions with stubbed network boundaries."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ("Claude-mac-universal.dmg", "Claude-win-x64.msix", "Claude-win-arm64.msix")
BOUNDARY = r'''#!/usr/bin/env python3
import json, os, pathlib, shutil, sys
args = sys.argv[1:]
name = pathlib.Path(sys.argv[0]).name
fixtures = pathlib.Path(os.environ["FIXTURES"])
with open(os.environ["CALLS"], "a") as log:
    log.write(json.dumps([name] + args) + "\n")
if name == "gh":
    if args[:2] == ["release", "list"]:
        print(os.environ.get("LATEST_TAG", "v1"))
    elif args[0] == "api" and args[1].endswith("/releases/latest"):
        if os.environ.get("GH_FAIL") == "1": sys.exit(1)
        print(os.environ.get("CANONICAL_TAG", os.environ.get("LATEST_TAG", "v1")))
    elif args[:2] == ["release", "download"]:
        if os.environ.get("GH_FAIL") == "1": sys.exit(1)
        target = pathlib.Path(args[args.index("-D") + 1])
        for i, arg in enumerate(args):
            if arg == "-p": shutil.copyfile(fixtures / args[i + 1], target / args[i + 1])
    elif args[:2] == ["release", "view"]:
        sys.exit(0 if os.environ.get("TAG_EXISTS") == "1" else 1)
    else: sys.exit("Unexpected gh command")
elif name == "curl":
    if "-D" in args:
        url = args[-1]
        kind = "mac" if "/darwin/" in url else ("arm64" if "/arm64/" in url else "x64")
        extension = "dmg" if kind == "mac" else "msix"
        print("HTTP/1.1 307 Temporary Redirect\nLocation: https://downloads.example/1.0/Claude-" + kind + "." + extension + "\n")
    elif "-fsSI" in args:
        print("HTTP/1.1 200 OK\nContent-Length: 4\n")
    else:
        if os.environ.get("PUBLIC_FAIL") == "1": sys.exit(22)
        target = pathlib.Path(args[args.index("-o") + 1])
        source = pathlib.Path(os.environ["PUBLIC_MANIFEST"])
        shutil.copyfile(source, target)
elif name == "aws":
    source = pathlib.Path(os.environ["BUCKET"]) / args[2].split("/", 3)[3]
    shutil.copyfile(source, args[3])
else: sys.exit("Unexpected boundary")
'''


class MirrorRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.work = Path(self.temp.name)
        self.fixtures = self.work / "fixtures"
        self.fixtures.mkdir()
        self.bin = self.work / "bin"
        self.bin.mkdir()
        for tool in ("gh", "curl", "aws"):
            executable = self.bin / tool
            executable.write_text(BOUNDARY)
            executable.chmod(0o755)
        self.manifest = {
            "version": "1.0",
            "sources": {
                "macos": {"universal": self.source("mac", "dmg", ASSETS[0])},
                "windows": {
                    "x64": self.source("x64", "msix", ASSETS[1]),
                    "arm64": self.source("arm64", "msix", ASSETS[2]),
                },
            },
        }
        self.write_fixtures()
        self.public = self.work / "public.json"
        shutil.copyfile(self.fixtures / "release-manifest.json", self.public)
        self.output = self.work / "output"
        self.calls = self.work / "calls"
        self.bucket = self.work / "bucket"
        self.bucket.mkdir()
        self.env = dict(os.environ, PATH=str(self.bin) + os.pathsep + os.environ["PATH"],
                        FIXTURES=str(self.fixtures), CALLS=str(self.calls),
                        PUBLIC_MANIFEST=str(self.public), GITHUB_OUTPUT=str(self.output),
                        R2_PUBLIC_BASE_URL="https://mirror.cognia.cn", R2_BUCKET_NAME="test",
                        R2_S3_ENDPOINT="https://r2.example", BUCKET=str(self.bucket),
                        GITHUB_RUN_ID="100", GITHUB_RUN_ATTEMPT="1")
        for key in ("RELEASE_TAG", "RESYNC_R2", "FORCE_RELEASE", "LATEST_TAG", "CANONICAL_TAG", "GH_FAIL", "TAG_EXISTS", "PUBLIC_FAIL"):
            self.env.pop(key, None)

    def source(self, kind, extension, name):
        (self.fixtures / name).write_bytes(b"data")
        return {"url": f"https://downloads.example/1.0/Claude-{kind}.{extension}",
                "contentLength": 4, "sha256": hashlib.sha256(b"data").hexdigest()}

    def write_fixtures(self):
        (self.fixtures / "release-manifest.json").write_text(json.dumps(self.manifest))
        lines = []
        for name in (*ASSETS, "release-manifest.json"):
            lines.append(hashlib.sha256((self.fixtures / name).read_bytes()).hexdigest() + "  " + name)
        (self.fixtures / "SHA256SUMS.txt").write_text("\n".join(lines) + "\n")

    def run_script(self, script, success=True, **env):
        result = subprocess.run(["bash", str(ROOT / "scripts" / script)], cwd=self.work,
                                env=dict(self.env, **env), text=True, capture_output=True)
        if success:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        return result

    def outputs(self):
        return self.output.read_text()

    def test_current_public_manifest_needs_no_sync(self):
        self.run_script("check-r2-recovery.sh")
        self.assertIn("should_sync=false", self.outputs())

    def test_mismatched_manifest_recovers_latest(self):
        self.public.write_text('{"stale": true}')
        self.run_script("check-r2-recovery.sh")
        self.assertIn("should_sync=true\nsync_tag=v1", self.outputs())

    def test_unavailable_public_manifest_recovers_latest(self):
        self.run_script("check-r2-recovery.sh", PUBLIC_FAIL="1")
        self.assertIn("should_sync=true", self.outputs())

    def test_manual_restore_accepts_explicit_latest_without_public_probe(self):
        self.run_script("check-r2-recovery.sh", RESYNC_R2="true", RELEASE_TAG="v1")
        self.assertIn("sync_tag=v1", self.outputs())
        self.assertNotIn('"curl"', self.calls.read_text())

    def test_manual_restore_rejects_older_release(self):
        self.run_script("check-r2-recovery.sh", success=False, RESYNC_R2="true", RELEASE_TAG="old-v1")
        self.assertNotIn('"download"', self.calls.read_text())
        self.assertFalse(self.output.exists())

    def test_recovery_uses_github_latest_marker_not_list_order(self):
        self.run_script("check-r2-recovery.sh", RESYNC_R2="true", RELEASE_TAG="v2",
                        LATEST_TAG="v1", CANONICAL_TAG="v2")
        self.assertIn("sync_tag=v2", self.outputs())

    def test_manual_restore_defaults_to_latest(self):
        self.run_script("check-r2-recovery.sh", RESYNC_R2="true")
        self.assertIn("should_sync=true\nsync_tag=v1", self.outputs())

    def test_absent_release_is_noop_automatically(self):
        self.run_script("check-r2-recovery.sh", LATEST_TAG="")
        self.assertIn("should_sync=false", self.outputs())

    def test_absent_release_fails_manual_restore(self):
        self.run_script("check-r2-recovery.sh", success=False, LATEST_TAG="", RESYNC_R2="true")

    def test_github_failure_is_not_silenced(self):
        self.run_script("check-r2-recovery.sh", success=False, GH_FAIL="1")

    def test_tag_cannot_inject_outputs(self):
        self.run_script("check-r2-recovery.sh", success=False, RESYNC_R2="true", RELEASE_TAG="v1\nshould_sync=false")
        self.assertFalse(self.output.exists())

    def test_restore_verifies_and_preserves_all_assets(self):
        self.run_script("restore-release-assets.sh", RELEASE_TAG="v1")
        for name in ASSETS:
            self.assertEqual((self.work / "dist" / name).read_bytes(), b"data")
        self.assertEqual((self.work / "release-manifest.json").read_bytes(), (self.fixtures / "release-manifest.json").read_bytes())

    def test_corrupt_asset_fails_before_copy(self):
        (self.fixtures / ASSETS[1]).write_bytes(b"corrupt")
        self.run_script("restore-release-assets.sh", success=False, RELEASE_TAG="v1")
        self.assertFalse((self.work / "dist").exists())

    def test_checksum_path_escape_is_rejected(self):
        with (self.fixtures / "SHA256SUMS.txt").open("a") as target:
            target.write("a" * 64 + "  /etc/passwd\n")
        self.run_script("restore-release-assets.sh", success=False, RELEASE_TAG="v1")

    def test_incomplete_checksums_are_rejected(self):
        (self.fixtures / "SHA256SUMS.txt").write_text("")
        self.run_script("restore-release-assets.sh", success=False, RELEASE_TAG="v1")

    def test_manifest_checksum_disagreement_is_rejected(self):
        self.manifest["sources"]["windows"]["x64"]["sha256"] = "0" * 64
        self.write_fixtures()
        self.run_script("restore-release-assets.sh", success=False, RELEASE_TAG="v1")

    def install_kit_boundary(self):
        kit = self.work / ".mirror-kit" / "scripts"
        kit.mkdir(parents=True)
        (kit / "sync-r2.sh").write_text('''#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$3" >> "$BUCKET/uploads"
if [[ "${FAIL_KEY:-}" == "$3" ]]; then exit 1; fi
mkdir -p "$BUCKET/$(dirname "$3")"
cp "$4" "$BUCKET/$3"
''')
        (kit / "clear-r2-prefix.sh").write_text('rm -rf "$BUCKET/$2"\n')

    def test_sync_promotes_verified_assets_and_manifest_last(self):
        self.run_script("restore-release-assets.sh", RELEASE_TAG="v1")
        self.install_kit_boundary()
        self.run_script("sync-release-to-r2.sh")
        self.assertEqual((self.bucket / "latest/manifest").read_bytes(), self.public.read_bytes())
        self.assertEqual((self.bucket / "uploads").read_text().splitlines()[-1], "latest/manifest")
        self.assertFalse((self.bucket / "staging/100-1").exists())

    def test_upload_failure_leaves_previous_manifest_for_recovery(self):
        self.run_script("restore-release-assets.sh", RELEASE_TAG="v1")
        self.install_kit_boundary()
        (self.bucket / "latest").mkdir()
        (self.bucket / "latest/manifest").write_text("old")
        self.run_script("sync-release-to-r2.sh", success=False, FAIL_KEY="latest/win-x64")
        self.assertEqual((self.bucket / "latest/manifest").read_text(), "old")
        self.assertFalse((self.bucket / "staging/100-1").exists())

    def test_public_mismatch_after_upload_fails(self):
        self.run_script("restore-release-assets.sh", RELEASE_TAG="v1")
        self.install_kit_boundary()
        self.public.write_text("stale")
        self.run_script("sync-release-to-r2.sh", success=False)

    def test_normal_probe_keeps_unchanged_release_skipped(self):
        self.run_script("probe-release.sh")
        self.assertIn("should_release=false", self.outputs())

    def test_probe_uses_github_latest_marker_not_list_order(self):
        self.run_script("probe-release.sh", LATEST_TAG="v1", CANONICAL_TAG="v2")
        self.assertIn("latest_tag=v2", self.outputs())

    def test_normal_probe_rejects_output_injection(self):
        self.run_script("probe-release.sh", success=False, RELEASE_TAG="v1\nshould_release=false")
        self.assertFalse(self.output.exists())

    def test_normal_probe_preserves_explicit_tag(self):
        self.run_script("probe-release.sh", FORCE_RELEASE="true", RELEASE_TAG="custom-v1")
        self.assertIn("release_tag=custom-v1", self.outputs())

    def test_normal_probe_skips_existing_predicted_tag(self):
        self.manifest["sources"]["macos"]["universal"]["url"] = "https://old.example"
        self.write_fixtures()
        self.run_script("probe-release.sh", TAG_EXISTS="1")
        self.assertIn("should_release=false", self.outputs())
        self.assertIn("already exists", self.outputs())

    def test_normal_probe_skips_older_official_version(self):
        self.manifest["version"] = "2.0"
        self.manifest["sources"]["macos"]["universal"]["url"] = "https://newer.example"
        self.write_fixtures()
        self.run_script("probe-release.sh")
        self.assertIn("should_release=false", self.outputs())
        self.assertIn("older than latest release", self.outputs())

    def test_normal_probe_publishes_changed_sources(self):
        self.manifest["sources"]["macos"]["universal"]["url"] = "https://old.example"
        self.write_fixtures()
        self.run_script("probe-release.sh")
        self.assertIn("should_release=true", self.outputs())

    def test_force_release_still_publishes(self):
        self.run_script("probe-release.sh", FORCE_RELEASE="true")
        self.assertIn("should_release=true", self.outputs())
        self.assertIn("release_tag=claude-app-force-", self.outputs())


if __name__ == "__main__":
    unittest.main()
