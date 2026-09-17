/*
<MODULE_CONTRACT>
  <purpose>component index — re-export the component contracts and schemas surface. Contract types sunk to @warpgogol/werkstatt-shared/component per RFC-1104; schemas and identity stay engine-local.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1104: contracts re-exported from werkstatt-shared/component; schemas + identity remain engine-local.</item>
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
} from "@warpgogol/werkstatt-shared/component";

export { SCOPE_ERROR_CODES } from "@warpgogol/werkstatt-shared/component";

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
