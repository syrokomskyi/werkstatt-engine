/*
<MODULE_CONTRACT>
<purpose>RFC-0364: Fallback text normalizer — normalize line endings and hash.</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0364: initial text normalizer.</item>
</CHANGE_SUMMARY>
*/

import { byteHash } from "../primitives.ts";

export function normalizeText(content: string): string {
  const normalized = content.replace(/\r\n/g, "\n");
  return byteHash(normalized);
}
