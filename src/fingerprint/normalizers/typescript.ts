/*
<MODULE_CONTRACT>
<purpose>Maintains packages/fingerprint/src/normalizers/typescript.ts as an authored fingerprint authored module so agents can evolve it without rediscovering local boundaries.</purpose>
<non-goals>
  <item>Do not hash raw bytes — that is the binary normalizer's job.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0364: initial TypeScript AST normalizer.</item>
</CHANGE_SUMMARY>
*/

import { parse } from "@typescript-eslint/typescript-estree";
import { byteHash } from "../primitives.ts";

export function normalizeTypeScript(content: string): string {
  const ast = parse(content, {
    loc: false,
    range: false,
    comment: false,
    tokens: false,
  });
  return byteHash(JSON.stringify(ast));
}
