/*
<MODULE_CONTRACT>
<purpose>Maintains packages/fingerprint/src/normalizers/binary.ts as an authored fingerprint authored module so agents can evolve it without rediscovering local boundaries.</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0364: initial binary normalizer.</item>
</CHANGE_SUMMARY>
*/

import { byteHash } from "../primitives.ts";

export function normalizeBinary(bytes: Uint8Array): string {
  return byteHash(bytes);
}
