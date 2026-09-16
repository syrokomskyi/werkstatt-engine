/*
<MODULE_CONTRACT>
<purpose>component index — re-export the component contracts and schemas surface.</purpose>
<non-goals>
  <item>Do not implement component logic here — it lives in sibling modules.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

export type {
  ComponentId,
  CapabilityId,
  EffectClass,
  IsolationTier,
  GrantScope,
  ResourceKind,
  LifecycleScope,
  ComponentScope,
  ScopeContext,
  ScopedRegistry,
  ScopeManager,
  CapabilityProvideV1,
  CapabilityRequireV1,
  GrantRequestV1,
  EffectDeclarationV1,
  EffectDeclarationExt,
  CompensationProbeType,
  CompensationProbe,
  CompensationAction,
  ProbeResult,
  CompensationResult,
  IsolationRequirementV1,
  ResourceBoundV1,
  ComponentDeclaration,
  ResolvedComponentIdentityV1,
  ResolvedComponentSetV1,
  ComponentContractViolation,
  ComponentContractResult,
} from "./contracts.ts";

export { SCOPE_ERROR_CODES } from "./contracts.ts";

export {
  parseComponentDeclaration,
  parseResolvedComponentSetV1,
  componentDeclarationSchema,
  resolvedComponentSetV1Schema,
} from "./schemas.ts";

export {
  computeManifestHash,
  computeSetHash,
  verifySetHash,
  verifySetHashStrict,
  computeDependencyGraphHash,
  computeGrantSetHash,
  computeEffectPolicyHash,
  computeIsolationPolicyHash,
} from "./identity.ts";

export type { SetHashMismatchViolation } from "./identity.ts";
