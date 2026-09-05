export type ComponentId = `${string}/${string}`;
export type CapabilityId = `${string}/${string}`;

export type EffectClass =
  "revertible" | "transactional" | "compensatable" | "irreversible-emission";

export type IsolationTier = "trusted-in-process" | "sandboxed";

export type GrantScope = "read" | "append" | "deploy" | "certify" | "administer";

export type ResourceKind = "cpu" | "memory" | "disk" | "network" | "timer" | "subprocess";

export type LifecycleScope = "process" | "request" | "session" | "scheduled";

export type ComponentScope =
  "per-command" | "per-mission" | "per-session" | "per-workshop" | "per-fleet";

export interface ScopeContext {
  readonly scope: ComponentScope;
  readonly missionId?: string;
  readonly sessionId?: string;
  readonly fleetId?: string;
  readonly invocationId?: string;
}

export interface ScopedRegistry {
  readonly context: ScopeContext;
  register(manifest: ComponentManifestV1): void;
  resolve(capabilityId: CapabilityId): ComponentManifestV1 | null;
  dispose(): void;
  list(): ReadonlyArray<ComponentManifestV1>;
  getScope(): ComponentScope;
}

export interface ScopeManager {
  getRegistry(context: ScopeContext): ScopedRegistry;
  disposeRegistry(context: ScopeContext): void;
  resolveAcrossScopes(
    capabilityId: CapabilityId,
    context: ScopeContext,
  ): ComponentManifestV1 | null;
  inspect(): ReadonlyArray<{
    context: ScopeContext;
    componentCount: number;
    componentIds: ComponentId[];
  }>;
  adopt(componentId: ComponentId, targetContext: ScopeContext): void;
  getScope(componentId: ComponentId): ComponentScope | null;
}

export const SCOPE_ERROR_CODES = {
  SCOPE_01: "SCOPE-01",
  SCOPE_02: "SCOPE-02",
  SCOPE_03: "SCOPE-03",
  SCOPE_04: "SCOPE-04",
  SCOPE_05: "SCOPE-05",
} as const;

export interface CapabilityProvideV1 {
  capability: CapabilityId;
  version: string;
  schemaHash: string;
}

export interface CapabilityRequireV1 {
  capability: CapabilityId;
  compatibility: string;
  schemaHash: string | null;
  optional: boolean;
}

export interface GrantRequestV1 {
  scope: GrantScope;
  resource: string;
  attenuated: boolean;
}

export interface EffectDeclarationV1 {
  effectClass: EffectClass;
  description: string;
  recoveryCommand: string | null;
  commitMetadata: string | null;
}

export interface IsolationRequirementV1 {
  tier: IsolationTier;
  adapterId: string | null;
}

export interface ResourceBoundV1 {
  kind: ResourceKind;
  limit: string;
  owner: ComponentId;
  lifecycle: LifecycleScope;
}

export interface ComponentManifestV1 {
  schema: "werkstatt/component-manifest@1";
  componentId: ComponentId;
  version: string;
  artifactHash: string;
  scope: ComponentScope;
  provides: CapabilityProvideV1[];
  requires: CapabilityRequireV1[];
  requestedGrants: GrantRequestV1[];
  effects: EffectDeclarationV1[];
  isolation: IsolationRequirementV1;
  resources: ResourceBoundV1[];
}

export interface ResolvedComponentIdentityV1 {
  componentId: ComponentId;
  version: string;
  artifactHash: string;
}

export interface ResolvedComponentSetV1 {
  schema: "werkstatt/resolved-component-set@1";
  profileId: string;
  components: ResolvedComponentIdentityV1[];
  dependencyGraphHash: string;
  grantSetHash: string;
  effectPolicyHash: string;
  isolationPolicyHash: string;
  setHash: string;
}

export interface ComponentContractViolation {
  rule: string;
  path: string;
  message: string;
}

export interface ComponentContractResult<T> {
  status: "pass" | "fail";
  data: T | null;
  violations: ComponentContractViolation[];
}
