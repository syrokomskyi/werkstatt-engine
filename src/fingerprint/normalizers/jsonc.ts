/*
<MODULE_CONTRACT>
<purpose>RFC-0364: JSONC normalizer using jsonc-parser — strip comments, stable stringify.</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0364: initial JSONC normalizer.</item>
</CHANGE_SUMMARY>
*/

import { parse as parseJsonc } from "jsonc-parser";
import { stableJsonHash } from "../primitives.ts";

export function normalizeJsonc(content: string): string {
  const parsed = parseJsonc(content);
  return stableJsonHash(parsed);
}
