/*
<MODULE_CONTRACT>
  <purpose>semver — semver parse and comparison helpers shared across the site-kernel packages.</purpose>
  <non-goals>
    <item>Do not support pre-release / build metadata / ranges beyond simple bounds — ecosystem versions are plain x.y.z.</item>
  </non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>Semver parsing is a small local implementation — no external semver dependency.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

export function parseSemver(value: string): [number, number, number] {
  const m = SEMVER_RE.exec(value.trim());
  if (!m) throw new Error(`not a valid x.y.z version: "${value}"`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** -1 if a < b, 0 if equal, 1 if a > b. */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] < pb[i]) return -1;
    if (pa[i] > pb[i]) return 1;
  }
  return 0;
}

export const ltSemver = (a: string, b: string): boolean => compareSemver(a, b) < 0;
export const gtSemver = (a: string, b: string): boolean => compareSemver(a, b) > 0;
export const eqSemver = (a: string, b: string): boolean => compareSemver(a, b) === 0;

/** True when `from < v <= to` — the half-open interval migrators are selected over. */
export function inOpenClosedRange(v: string, from: string, to: string): boolean {
  return gtSemver(v, from) && compareSemver(v, to) <= 0;
}
