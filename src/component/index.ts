export type {
  ComponentId,
  CapabilityId,
  EffectClass,
  IsolationTier,
  GrantScope,
  ResourceKind,
  LifecycleScope,
  CapabilityProvideV1,
  CapabilityRequireV1,
  GrantRequestV1,
  EffectDeclarationV1,
  IsolationRequirementV1,
  ResourceBoundV1,
  ComponentManifestV1,
  ResolvedComponentIdentityV1,
  ResolvedComponentSetV1,
  ComponentContractViolation,
  ComponentContractResult,
} from "./contracts.ts";

export {
  parseComponentManifestV1,
  parseResolvedComponentSetV1,
  componentManifestV1Schema,
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
