/*
<MODULE_CONTRACT>
<purpose>
RFC-0753: TXT record content normalization.
Cloudflare may return TXT record content with varying quoting and whitespace.
This utility normalizes TXT content for reliable comparison between
declared and live records.
</purpose>
<non-goals>
  <item>Do not normalize non-TXT record types — only TXT needs it.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0753: initial TXT normalization utility — normalizeTxtContent.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

export function normalizeTxtContent(content: string): string {
  return content
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\\([.;()"])|(["'])/g, "$1$2")
    .trim()
    .replace(/\s+/g, " ");
}

export function ensureTxtQuoted(content: string): string {
  let stripped = content.trim();
  if (
    stripped.length >= 2 &&
    ((stripped.startsWith('"') && stripped.endsWith('"')) ||
      (stripped.startsWith("'") && stripped.endsWith("'")))
  ) {
    stripped = stripped.slice(1, -1);
  }
  stripped = stripped
    .replace(/\\([.;()"])|(["'])/g, "$1$2")
    .trim()
    .replace(/\s+/g, " ");
  return `"${stripped.replace(/"/g, '\\"')}"`;
}
