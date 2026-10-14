#!/usr/bin/env python3
"""Set only each workspace manifest's top-level version after approval."""

import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[5]
MANIFESTS = Path(__file__).with_name("manifests.txt")
EXPECTED_CURRENT = "2.0.0-snapshot.22"


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: set_workspace_version.py <approved-version>")
    target = sys.argv[1]
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+-[A-Za-z0-9.-]+", target):
        raise SystemExit(f"invalid snapshot version: {target!r}")

    paths = [line.strip() for line in MANIFESTS.read_text().splitlines() if line.strip()]
    if len(paths) != 31 or len(set(paths)) != 31:
        raise SystemExit(f"expected 31 unique manifest paths, found {len(paths)}")

    changes: list[tuple[Path, str]] = []
    for relative in paths:
        path = ROOT / relative
        before = path.read_text()
        parsed_before = json.loads(before)
        if parsed_before.get("version") != EXPECTED_CURRENT:
            raise SystemExit(f"unexpected current version at {relative}: {parsed_before.get('version')!r}")

        # Workspace top-level properties use two-space indentation. This avoids
        # matching nested dependency metadata and preserves all other bytes.
        pattern = re.compile(r'(?m)^(  "version"\s*:\s*")[^"]*(")')
        updated, count = pattern.subn(lambda match: f"{match.group(1)}{target}{match.group(2)}", before)
        if count != 1:
            raise SystemExit(f"expected one top-level version field at {relative}; found {count}")
        parsed_after = json.loads(updated)
        parsed_after["version"] = parsed_before["version"]
        if parsed_after != parsed_before:
            raise SystemExit(f"semantic change beyond top-level version at {relative}")
        changes.append((path, updated))

    # All files are validated before the first write.
    for path, updated in changes:
        path.write_text(updated)
    print(f"updated top-level version in {len(changes)} workspace manifests to {target}")


if __name__ == "__main__":
    main()
