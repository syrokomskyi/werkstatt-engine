/*
<MODULE_CONTRACT>
  <purpose>Semver parse and comparison helpers shared across site-kernel packages.</purpose>
  <non-goals>
    <item>Do not support pre-release / build metadata / ranges beyond simple bounds — ecosystem versions are plain x.y.z.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Extracted from site-kernel-handoff/src/semver.ts to break cyclic dependency (ADR-0015).</item>
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
