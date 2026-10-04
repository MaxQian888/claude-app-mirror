#!/usr/bin/env python3
"""Keep one verified published Release and its R2 aliases; dry-run by default.

Run inside mirror.yml's concurrency group so uploads cannot overlap cleanup.
Git tags, draft Releases, and stats/ objects are outside the retention policy.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time


ASSETS = {
    "mac": "Claude-mac-universal.dmg",
    "win-x64": "Claude-win-x64.msix",
    "win-arm64": "Claude-win-arm64.msix",
    "checksums": "SHA256SUMS.txt",
    "manifest": "release-manifest.json",
}


def output(*args):
    return subprocess.check_output(args)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def prune(apply=False):
    repo = os.environ["GH_REPO"]
    bucket = os.environ["R2_BUCKET_NAME"]
    endpoint = os.environ["R2_S3_ENDPOINT"]
    public_base = os.environ["R2_PUBLIC_BASE_URL"].rstrip("/")
    require(re.fullmatch(r"[\w.-]+/[\w.-]+", repo), "Invalid GH_REPO")
    api = f"repos/{repo}/releases"
    aws = ("--bucket", bucket, "--endpoint-url", endpoint, "--region", "auto", "--output", "json")

    def latest_release():
        return json.loads(output("gh", "api", f"{api}/latest"))

    latest = latest_release()
    require(not latest["draft"] and not latest["prerelease"] and latest["published_at"],
            "Latest Release must be published and stable")
    tag = latest["tag_name"]
    require(tag and not tag.startswith("-") and "\n" not in tag and "\r" not in tag,
            "Invalid latest Release tag")
    assets = {asset["name"]: asset for asset in latest["assets"]}
    for name in ASSETS.values():
        require(name in assets and assets[name]["state"] == "uploaded" and assets[name]["size"] > 0,
                f"Latest Release is missing a complete asset: {name}")

    pages = json.loads(output("gh", "api", f"{api}?per_page=100", "--paginate", "--slurp"))
    releases = [release for page in pages for release in page]
    require(any(release["id"] == latest["id"] for release in releases),
            "Latest Release is missing from the listing; retry")
    obsolete = [release for release in releases if not release["draft"] and release["id"] != latest["id"]]
    require(all(release["published_at"] and release["published_at"] <= latest["published_at"]
                for release in obsolete), "A newer published Release exists; refusing to delete it")

    # AWS CLI automatically collects every S3 page when JSON output is used.
    objects = json.loads(output("aws", "s3api", "list-objects-v2", *aws)).get("Contents", [])
    sizes = {obj["Key"]: obj["Size"] for obj in objects}
    keep_keys = {f"latest/{alias}" for alias in ASSETS}
    stale_keys = sorted(key for key in sizes if key not in keep_keys and not key.startswith("stats/"))
    for alias, name in ASSETS.items():
        require(sizes.get(f"latest/{alias}") == assets[name]["size"],
                f"R2 latest/{alias} is missing or has the wrong size")

    with tempfile.TemporaryDirectory() as directory:
        temp = Path(directory)
        output("gh", "release", "download", tag, "--repo", repo, "--dir", directory,
               "--pattern", "release-manifest.json", "--pattern", "SHA256SUMS.txt")
        manifest_bytes = (temp / "release-manifest.json").read_bytes()
        checksum_bytes = (temp / "SHA256SUMS.txt").read_bytes()
        checksums = {}
        for line in checksum_bytes.decode().splitlines():
            match = re.fullmatch(r"([0-9a-f]{64})  (.+)", line)
            require(match is not None, "Invalid checksum entry")
            digest, name = match.groups()
            require(name not in checksums, "Duplicate checksum entry")
            checksums[name] = digest
        require(set(checksums) == set(ASSETS.values()) - {"SHA256SUMS.txt"},
                "Incomplete or unexpected checksum entries")
        require(checksums["release-manifest.json"] == hashlib.sha256(manifest_bytes).hexdigest(),
                "Release manifest checksum mismatch")
        sources = json.loads(manifest_bytes)["sources"]
        for alias, source in (("mac", sources["macos"]["universal"]),
                              ("win-x64", sources["windows"]["x64"]),
                              ("win-arm64", sources["windows"]["arm64"])):
            name = ASSETS[alias]
            require(source["assetName"] == name and source["sha256"] == checksums[name]
                    and source["contentLength"] == assets[name]["size"],
                    f"Release metadata disagrees for {name}")
        for alias in ("manifest", "checksums"):
            expected = (temp / ASSETS[alias]).read_bytes()
            target = temp / alias
            output("aws", "s3", "cp", f"s3://{bucket}/latest/{alias}", str(target),
                   "--endpoint-url", endpoint, "--region", "auto", "--no-progress")
            require(target.read_bytes() == expected, f"R2 {alias} differs from latest Release")
            public = output("curl", "--fail", "--silent", "--show-error", "--location",
                            "--retry", "2", "--connect-timeout", "20", "--max-time", "120",
                            f"{public_base}/latest/{alias}?retention={time.time_ns()}")
            require(public == expected, f"Public {alias} differs from latest Release")

        # Only download installers when there are fallbacks to delete. A regular
        # no-op check stays small, while every destructive cleanup verifies bytes.
        if obsolete or stale_keys:
            for alias in ("mac", "win-x64", "win-arm64"):
                target = temp / alias
                output("aws", "s3", "cp", f"s3://{bucket}/latest/{alias}", str(target),
                       "--endpoint-url", endpoint, "--region", "auto", "--no-progress")
                digest = hashlib.sha256()
                with target.open("rb") as installer:
                    for chunk in iter(lambda: installer.read(1024 * 1024), b""):
                        digest.update(chunk)
                require(digest.hexdigest() == checksums[ASSETS[alias]],
                        f"R2 latest/{alias} checksum mismatch")
                print(f"Verified SHA-256: latest/{alias}", flush=True)
                target.unlink()

    print(f"Keep Release {tag} ({latest['id']}); keep five latest/ objects and stats/", flush=True)
    print(f"{'Apply' if apply else 'Dry run'}: remove {len(obsolete)} Releases and {len(stale_keys)} R2 objects", flush=True)
    for key in stale_keys:
        print(f"Remove R2 object: {key}", flush=True)
    for release in obsolete:
        print(f"Remove Release: {release['tag_name']} ({release['id']})", flush=True)
    if not apply:
        return

    def check_latest():
        require(latest_release()["id"] == latest["id"], "Latest Release changed; aborting cleanup")

    # Delete R2 leftovers first, so an R2 failure keeps the old Releases available.
    for key in stale_keys:
        check_latest()
        output("aws", "s3api", "delete-object", *aws, "--key", key)
    for release in obsolete:
        check_latest()
        output("gh", "api", f"{api}/{release['id']}", "--method", "DELETE")
    print("Retention cleanup completed", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true", help="Delete obsolete Releases and R2 objects")
    mode.add_argument("--dry-run", action="store_true", help="Validate and print the plan (default)")
    prune(apply=parser.parse_args().apply)
