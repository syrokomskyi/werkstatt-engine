/*
<MODULE_CONTRACT>
<purpose>Maintains packages/os/site-kernel-handoff/src/semver.ts as an authored site-kernel-handoff authored module so agents can evolve it without rediscovering local boundaries.</purpose>
<non-goals>
  <item>Do not support pre-release / build metadata / ranges beyond simple bounds — ecosystem versions are plain x.y.z.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0221: initial semver helper.</item>
</CHANGE_SUMMARY>
*/

export {
  parseSemver,
  compareSemver,
  ltSemver,
  gtSemver,
  eqSemver,
  inOpenClosedRange,
} from "@warpgogol/werkstatt-engine/kernel";
