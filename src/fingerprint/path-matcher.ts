/*
<MODULE_CONTRACT>
<purpose>
  Path matching utility for fingerprint tree walking. Extracted from
  fingerprint.ts to centralize ignore-pattern logic and enable testing.
</purpose>
<non-goals>
  <item>Do not implement tree walking — that stays in fingerprint.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Architecture review 2026-07-14: extract path normalization and ignore matching from fingerprint.ts.</item>
</CHANGE_SUMMARY>
*/

export function normalizePathSep(p: string): string {
  return p.replace(/\\/g, "/");
}

export function shouldIgnore(filePath: string, ignore: string[]): boolean {
  const normalized = normalizePathSep(filePath);
  for (const pattern of ignore) {
    if (normalized.includes(pattern)) return true;
  }
  return false;
}
