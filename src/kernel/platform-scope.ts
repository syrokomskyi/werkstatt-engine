/*
<MODULE_CONTRACT>
  <purpose>Shared platform-scope constants and helpers for ecosystem.commit and PC-04 rule.</purpose>
  <non-goals>
    <item>Do not define git or validation logic here — only scope classification and trailer matching.</item>
  </non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>Platform scope is a fixed path list — shared by ecosystem.commit and the PC-04 rule.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
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
