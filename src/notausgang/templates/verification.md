# Verifying this package

This Notausgang export is self-verifying. Two paths are available: the bundled
script (recommended) and a fully manual fallback that needs only `sha256sum`
(or `shasum -a 256` on macOS).

## Automated verification (recommended)

Requirements: Python 3.8+ (standard library only — no packages to install).

```sh
python3 verify.py
```

The script checks, in order:

1. All required files and directories are present.
2. `notausgang-manifest.json` parses and declares the verifier contract.
3. Every file listed in `SHA256SUMS.txt` matches its recorded SHA-256.
4. Every file in the package is covered by `SHA256SUMS.txt` (completeness).
5. Every `evidence/<source-id>/integrity.txt` entry matches its artifact bytes.

Exit code `0` means the package is intact. Any `FAIL` line names the exact
file and the expected vs. actual digest.

## Manual fallback

If Python is unavailable, verify the package with standard tools:

```sh
# From the package root — verify every file against the checksum list.
sha256sum --check SHA256SUMS.txt

# Verify bundled evidence artifacts (one integrity.txt per source).
cd evidence/<source-id> && sha256sum --check integrity.txt
```

`SHA256SUMS.txt` itself is the trust root of the package: it is not covered by
its own list. If you received the package over an untrusted channel, compare
`notausgang-manifest.yaml` fields (`releaseId`, `exportedAt`, `distHash`,
`siteHash`, `bordbuchHash`) against the values communicated to you separately.

## What is covered

| Artifact | Integrity anchor |
| --- | --- |
| `dist/` (built site) | `distHash` in the manifest + per-file SHA-256 in `SHA256SUMS.txt` |
| `site/` (authored content) | `siteHash` in the manifest + per-file SHA-256 |
| `bordbuch/events.ndjson` (history) | `bordbuchHash` in the manifest + per-file SHA-256 |
| `evidence/` (proof artifacts) | per-file SHA-256 in each `integrity.txt` + `SHA256SUMS.txt` |
| `feature-notes.md` (disclosure) | per-file SHA-256 in `SHA256SUMS.txt` |

## If verification fails

A failed check means the package was modified or corrupted after export.
Do not deploy or rely on a failed package — request a fresh export.
