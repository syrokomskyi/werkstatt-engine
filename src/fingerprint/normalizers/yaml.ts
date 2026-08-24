/*
<MODULE_CONTRACT>
<purpose>RFC-0364: YAML normalizer using yaml package — parse and re-serialize in stable form.</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0364: initial YAML normalizer.</item>
</CHANGE_SUMMARY>
*/

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { byteHash } from "../primitives.ts";

export function normalizeYaml(content: string): string {
  const parsed = parseYaml(content);
  const reSerialized = stringifyYaml(parsed, { sortMapEntries: true });
  return byteHash(reSerialized);
}
