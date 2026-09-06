import type { Sha256Digest } from "../fingerprint/primitives.ts";

export type ComponentId = `${string}/${string}`;
export type CapabilityId = `${string}/${string}`;

export type EffectClass =
  "revertible" | "transactional" | "compensatable" | "irreversible-emission";

export type IsolationTier = 0 | 1 | 2 | 3;

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
  register(manifest: ComponentDeclaration): void;
  resolve(capabilityId: CapabilityId): ComponentDeclaration | null;
  dispose(): void;
  list(): ReadonlyArray<ComponentDeclaration>;
  getScope(): ComponentScope;
}

export interface ScopeManager {
  getRegistry(context: ScopeContext): ScopedRegistry;
  disposeRegistry(context: ScopeContext): void;
  resolveAcrossScopes(
    capabilityId: CapabilityId,
    context: ScopeContext,
  ): ComponentDeclaration | null;
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

/** RFC-1037: Probe type for compensation verification. */
export type CompensationProbeType =
  "dns-resolved" | "http-status" | "cdn-cleared" | "mirror-synced" | "custom";

/** RFC-1037: A single verification probe that checks equivalence after compensation. */
export interface CompensationProbe {
  readonly type: CompensationProbeType;
  readonly target: string;
  readonly expected: string;
  readonly timeoutMs: number;
  readonly customVerifyCommand?: string;
}

/** RFC-1037: The compensating action with verification probes. */
export interface CompensationAction {
  readonly compensatingOperation: string;
  readonly verificationProbes: readonly CompensationProbe[];
  readonly verificationTimeoutMs: number;
  readonly failureMode: "blocking" | "non-blocking";
}

/** RFC-1037: Result of a single probe execution. */
export interface ProbeResult {
  readonly probe: CompensationProbe;
  readonly passed: boolean;
  readonly actualValue?: string;
  readonly latencyMs: number;
}

/** RFC-1037: Result of compensation verification. */
export interface CompensationResult {
  readonly operationHash: Sha256Digest;
  readonly compensationHash: Sha256Digest;
  readonly verified: boolean;
  readonly probeResults: readonly ProbeResult[];
  readonly verifiedAt: string;
  readonly failureReason?: string;
}

/** RFC-1037: Extension of EffectDeclarationV1 with compensation verification contracts. */
export interface EffectDeclarationExt extends EffectDeclarationV1 {
  readonly compensation?: CompensationAction;
  readonly commitBoundary?: string;
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

export interface ComponentDeclaration {
  schema: "werkstatt/component-declaration@1";
  /** Stable component ID — survives reconfiguration without losing identity. */
  componentId: ComponentId;
  version: string;
  artifactHash: Sha256Digest;
  scope: ComponentScope;
  provides: CapabilityProvideV1[];
  requires: CapabilityRequireV1[];
  requestedGrants: GrantRequestV1[];
  effects: EffectDeclarationV1[];
  isolation: IsolationRequirementV1;
  resources: ResourceBoundV1[];
  /** Configuration overrides for this component instance. */
  config?: Record<string, unknown>;
  /** Priority — higher priority components override lower for the same capability. */
  priority: number;
  /** Whether this component is desired to be active. */
  active: boolean;
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
