#!/usr/bin/env python3
"""Notausgang export package verifier (RFC-1120).

Standalone, Python 3 standard library only — no third-party dependencies.
Verifies the integrity of a Notausgang exit package:

  1. Required files and directories are present.
  2. Every file listed in SHA256SUMS.txt matches its recorded SHA-256.
  3. Every file in the package is covered by SHA256SUMS.txt (completeness).
  4. Every evidence/<source-id>/integrity.txt entry matches its artifact bytes.
  5. notausgang-manifest.json parses and carries the verifier contract.

Usage:
    python3 verify.py [package-dir]

Exit code: 0 when all checks pass, 1 otherwise.
See verification.md for the manual fallback procedure.
"""

import hashlib
import json
import sys
from pathlib import Path

REQUIRED_FILES = [
    "notausgang-manifest.yaml",
    "notausgang-manifest.json",
    "README.md",
    "SHA256SUMS.txt",
    "feature-notes.md",
    "verification.md",
    "verify.py",
    "system.pin.yaml",
    "bordbuch/events.ndjson",
]

REQUIRED_DIRS = ["dist", "site", "bordbuch", "evidence"]

# Files that are intentionally not covered by SHA256SUMS.txt.
SUMS_SELF = "SHA256SUMS.txt"

failures = []


def check(ok, label, detail=""):
    status = "PASS" if ok else "FAIL"
    line = f"[{status}] {label}" + (f" — {detail}" if detail else "")
    print(line)
    if not ok:
        failures.append(label)


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def parse_sums(path):
    """Parse sha256sum-format lines: '<hex>  <relpath>'."""
    entries = []
    for lineno, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.rstrip("\n")
        if not line.strip():
            continue
        if "  " not in line:
            check(False, f"{path.name}:{lineno}", "malformed line (expected '<sha256>  <path>')")
            continue
        digest, rel = line.split("  ", 1)
        entries.append((digest.strip(), rel.strip()))
    return entries


def main():
    root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(__file__).resolve().parent
    print(f"Notausgang package verification: {root}")

    if not root.is_dir():
        print(f"error: package directory not found: {root}", file=sys.stderr)
        return 1

    # 1. Required files and directories
    for rel in REQUIRED_FILES:
        check((root / rel).is_file(), f"required file: {rel}")
    for rel in REQUIRED_DIRS:
        check((root / rel).is_dir(), f"required directory: {rel}/")

    # 2. Manifest JSON parses and carries the verifier contract
    manifest_json = root / "notausgang-manifest.json"
    manifest = None
    if manifest_json.is_file():
        try:
            manifest = json.loads(manifest_json.read_text(encoding="utf-8"))
            check(True, "notausgang-manifest.json parses")
            verifier = manifest.get("verifier") or {}
            check(
                verifier.get("script") == "verify.py"
                and verifier.get("manifestFile") == "notausgang-manifest.json",
                "manifest verifier contract",
                json.dumps(verifier),
            )
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            check(False, "notausgang-manifest.json parses", str(exc))

    # 3. SHA256SUMS.txt — verify every listed file
    sums_path = root / SUMS_SELF
    listed = set()
    if sums_path.is_file():
        for digest, rel in parse_sums(sums_path):
            listed.add(rel)
            target = root / rel
            if not target.is_file():
                check(False, f"sha256: {rel}", "file missing")
                continue
            actual = sha256_file(target)
            check(actual == digest, f"sha256: {rel}", f"expected {digest}, got {actual}" if actual != digest else "")
    else:
        check(False, "SHA256SUMS.txt present")

    # 4. Completeness — every package file must be listed in SHA256SUMS.txt
    if sums_path.is_file():
        for p in sorted(root.rglob("*")):
            if not p.is_file():
                continue
            rel = p.relative_to(root).as_posix()
            if rel == SUMS_SELF:
                continue
            check(rel in listed, f"coverage: {rel}", "not listed in SHA256SUMS.txt" if rel not in listed else "")

    # 5. evidence/*/integrity.txt — re-verify artifact bytes
    evidence_root = root / "evidence"
    if evidence_root.is_dir():
        for integrity in sorted(evidence_root.glob("*/integrity.txt")):
            for digest, rel in parse_sums(integrity):
                target = integrity.parent / rel
                if not target.is_file():
                    check(False, f"evidence: {integrity.parent.name}/{rel}", "artifact missing")
                    continue
                actual = sha256_file(target)
                check(
                    actual == digest,
                    f"evidence: {integrity.parent.name}/{rel}",
                    f"expected {digest}, got {actual}" if actual != digest else "",
                )

    print()
    if failures:
        print(f"FAILED — {len(failures)} check(s) failed")
        return 1
    print("OK — all checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
