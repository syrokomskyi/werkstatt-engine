/*
<MODULE_CONTRACT>
  <purpose>Shared platform-scope constants and helpers for ecosystem.commit and PC-04 rule.</purpose>
  <non-goals>
    <item>Do not define git or validation logic here — only scope classification and trailer matching.</item>
  </non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>TODO: record current design decisions</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into <history>, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
</CHANGE_SUMMARY>
*/

export const PLATFORM_SCOPE_PREFIXES = ["packages/", "integrations/", "services/"];

export function isPlatformScope(filePath: string): boolean {
  return PLATFORM_SCOPE_PREFIXES.some((prefix) => filePath.startsWith(prefix));
}

export function hasPlatformScopeFiles(files: string[]): boolean {
  return files.some(isPlatformScope);
}

export function extractTrailer(message: string, key: string): string | null {
  const re = new RegExp(`^${key}:\\s*(.+)$`, "im");
  const m = message.match(re);
  return m ? m[1].trim() : null;
}

export function hasTrailer(message: string, key: string): boolean {
  return extractTrailer(message, key) !== null;
}
