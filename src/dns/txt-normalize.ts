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
  <item>Fix: add ensureTxtQuoted — wraps TXT content in double quotes for Cloudflare API payload.</item>
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
