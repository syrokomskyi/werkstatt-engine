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
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into <history>, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
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
