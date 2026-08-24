/*
<MODULE_CONTRACT>
  <purpose>Shared platform-scope constants and helpers for ecosystem.commit and PC-04 rule.</purpose>
  <non-goals>
    <item>Do not define git or validation logic here — only scope classification and trailer matching.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Extracted from site-kernel-handoff/src/platform-scope.ts to break cyclic dependency (ADR-0015).</item>
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
