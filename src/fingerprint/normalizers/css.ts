/*
<MODULE_CONTRACT>
<purpose>Maintains packages/fingerprint/src/normalizers/css.ts as an authored fingerprint authored module so agents can evolve it without rediscovering local boundaries.</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0364: initial CSS normalizer.</item>
</CHANGE_SUMMARY>
*/

import postcss from "postcss";
import { byteHash } from "../primitives.ts";

export function normalizeCss(content: string): string {
  const root = postcss.parse(content);
  root.walkComments((node) => {
    node.remove();
  });
  const result = root.toString().replace(/\s+/g, " ").trim();
  return byteHash(result);
}
