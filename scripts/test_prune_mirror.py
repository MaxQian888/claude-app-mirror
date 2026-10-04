"""Retention tests with GitHub, S3 and HTTP boundaries replaced by fixtures."""
import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

import prune_mirror


class RetentionTests(unittest.TestCase):
    def setUp(self):
        self.names = {
            "mac": "Claude-mac-universal.dmg",
            "win-x64": "Claude-win-x64.msix",
            "win-arm64": "Claude-win-arm64.msix",
            "checksums": "SHA256SUMS.txt",
            "manifest": "release-manifest.json",
        }
        source = lambda name: {"assetName": name, "contentLength": 4,
                               "sha256": hashlib.sha256(b"data").hexdigest()}
        manifest = {"sources": {
            "macos": {"universal": source(self.names["mac"])},
            "windows": {"x64": source(self.names["win-x64"]),
                        "arm64": source(self.names["win-arm64"])},
        }}
        self.files = {name: b"data" for name in self.names.values()}
        self.files["release-manifest.json"] = json.dumps(manifest).encode()
        self.files["SHA256SUMS.txt"] = "".join(
            f"{hashlib.sha256(data).hexdigest()}  {name}\n"
            for name, data in self.files.items() if name != "SHA256SUMS.txt"
        ).encode()
        self.latest = {"id": 200, "tag_name": "v2", "draft": False,
                       "prerelease": False, "published_at": "2026-10-02T00:00:00Z",
                       "assets": [{"name": name, "state": "uploaded", "size": len(data)}
                                  for name, data in self.files.items()]}
        self.old = dict(self.latest, id=100, tag_name="v1", published_at="2026-10-01T00:00:00Z")
        self.pages = [[self.old], [self.latest]]
        self.objects = {f"latest/{key}": data for key, name in self.names.items()
                        for data in [self.files[name]]}
        self.objects.update({"versions/v1/mac": b"old", "staging/123/mac": b"old",
                             "latest/obsolete": b"old", "stats/state.json": b"stats",
                             "stats/downloads.json": b"stats"})
        self.public = copy.deepcopy(self.objects)
        self.calls = []
        self.latest_calls = 0
        self.change_latest_after = None
        self.fail_delete = False
        self.addCleanup(patch.stopall)
        patch.dict(os.environ, GH_REPO="owner/repo", R2_BUCKET_NAME="mirror",
                   R2_S3_ENDPOINT="https://r2.example", R2_PUBLIC_BASE_URL="https://mirror.example").start()
        patch.object(prune_mirror, "output", self.boundary).start()

    def boundary(self, *args):
        self.calls.append(args)
        if args[0] == "gh":
            if args[1] == "api":
                if "DELETE" in args:
                    if self.fail_delete:
                        raise subprocess.CalledProcessError(1, args)
                    return b""
                if args[2].endswith("/latest"):
                    self.latest_calls += 1
                    value = self.latest
                    if self.change_latest_after and self.latest_calls > self.change_latest_after:
                        value = dict(value, id=300)
                    return json.dumps(value).encode()
                return json.dumps(self.pages).encode()
            if args[1:3] == ("release", "download"):
                directory = Path(args[args.index("--dir") + 1])
                for i, arg in enumerate(args):
                    if arg == "--pattern":
                        name = args[i + 1]
                        (directory / name).write_bytes(self.files[name])
                return b""
        if args[0] == "aws":
            if "list-objects-v2" in args:
                return json.dumps({"Contents": [{"Key": key, "Size": len(data)}
                                                for key, data in self.objects.items()]}).encode()
            if args[1:3] == ("s3", "cp"):
                key = args[3].split("/", 3)[3]
                Path(args[4]).write_bytes(self.objects[key])
                return b""
            if "delete-object" in args:
                if self.fail_delete:
                    raise subprocess.CalledProcessError(1, args)
                del self.objects[args[args.index("--key") + 1]]
                return b""
        if args[0] == "curl":
            key = args[-1].split(".example/", 1)[1].split("?", 1)[0]
            return self.public[key]
        raise AssertionError(f"Unexpected command: {args}")

    def deletions(self):
        return [call for call in self.calls if "DELETE" in call or "delete-object" in call]

    def assert_safe_failure(self):
        with self.assertRaises((ValueError, subprocess.CalledProcessError)):
            prune_mirror.prune(apply=True)
        self.assertEqual(self.deletions(), [])

    def test_dry_run_never_deletes(self):
        prune_mirror.prune()
        self.assertEqual(self.deletions(), [])

    def test_keeps_canonical_latest_across_pages_and_preserves_stats_and_tags(self):
        prune_mirror.prune(apply=True)
        deletes = self.deletions()
        self.assertEqual(len(deletes), 4)
        self.assertEqual([call[2] for call in deletes if call[0] == "gh"],
                         ["repos/owner/repo/releases/100"])
        self.assertEqual(set(self.objects), {f"latest/{key}" for key in self.names} |
                         {"stats/state.json", "stats/downloads.json"})
        listing = next(call for call in self.calls if "--paginate" in call)
        self.assertIn("--slurp", listing)
        self.assertFalse(any("refs/" in arg for call in self.calls for arg in call))

    def test_drafts_are_preserved(self):
        self.pages[0].append(dict(self.old, id=90, draft=True))
        prune_mirror.prune(apply=True)
        self.assertEqual(len([call for call in self.deletions() if call[0] == "gh"]), 1)

    def test_one_release_and_latest_only_is_noop(self):
        self.pages = [[self.latest]]
        self.objects = {key: data for key, data in self.objects.items()
                        if key in {f"latest/{alias}" for alias in self.names} or key.startswith("stats/")}
        prune_mirror.prune(apply=True)
        self.assertEqual(self.deletions(), [])
        downloaded = [call[3] for call in self.calls if call[:3] == ("aws", "s3", "cp")]
        self.assertEqual(downloaded, ["s3://mirror/latest/manifest", "s3://mirror/latest/checksums"])

    def test_newer_published_release_aborts(self):
        self.pages[0][0] = dict(self.old, published_at="2026-10-03T00:00:00Z")
        self.assert_safe_failure()

    def test_latest_missing_from_snapshot_aborts(self):
        self.pages = [[self.old]]
        self.assert_safe_failure()

    def test_missing_or_pending_latest_assets_abort(self):
        self.latest["assets"][0]["state"] = "starter"
        self.assert_safe_failure()

    def test_missing_r2_installer_aborts(self):
        del self.objects["latest/mac"]
        self.assert_safe_failure()

    def test_wrong_r2_size_aborts(self):
        self.objects["latest/mac"] = b"wrong size"
        self.assert_safe_failure()

    def test_same_size_corrupt_installer_prevents_deletion(self):
        self.objects["latest/mac"] = b"FAIL"
        self.assert_safe_failure()

    def test_stale_r2_manifest_aborts(self):
        data = self.objects["latest/manifest"]
        self.objects["latest/manifest"] = b"x" * len(data)
        self.assert_safe_failure()

    def test_stale_public_manifest_aborts(self):
        self.public["latest/manifest"] = b"stale"
        self.assert_safe_failure()

    def test_stale_public_checksums_abort(self):
        self.public["latest/checksums"] = b"stale"
        self.assert_safe_failure()

    def test_invalid_checksums_abort(self):
        self.files["SHA256SUMS.txt"] = b"invalid"
        self.assert_safe_failure()

    def test_latest_changed_before_deletion_aborts(self):
        self.change_latest_after = 1
        self.assert_safe_failure()

    def test_delete_failure_is_reported_and_no_github_release_deleted(self):
        self.fail_delete = True
        with self.assertRaises(subprocess.CalledProcessError):
            prune_mirror.prune(apply=True)
        self.assertFalse(any("DELETE" in call for call in self.calls))

    def test_network_failure_prevents_all_deletions(self):
        with patch.object(prune_mirror, "output", side_effect=subprocess.CalledProcessError(1, "gh")):
            self.assert_safe_failure()


if __name__ == "__main__":
    unittest.main()
