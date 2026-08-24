import type { CapabilityId, GrantScope } from "../component/contracts.ts";
import type { Sha256Digest } from "../fingerprint/primitives.ts";

export type IsolationPropertyKind =
  | "containment"
  | "clean-room-startup"
  | "artifact-immutability"
  | "grant-enforcement"
  | "egress-controls"
  | "resource-limits"
  | "secret-non-inheritance"
  | "teardown"
  | "crash-recovery"
  | "concurrent-workload-separation"
  | "bridge-confusion-replay"
  | "host-compromise-assumptions";

export interface IsolationPropertyEvidenceV1 {
  readonly schema: "werkstatt/isolation-property-evidence@1";
  readonly properties: ReadonlyArray<{
    readonly kind: IsolationPropertyKind;
    readonly proven: boolean;
    readonly evidenceHash: Sha256Digest;
    readonly description: string;
  }>;
  readonly unsupported: readonly IsolationPropertyKind[];
}

export interface AttenuatedGrantV1 {
  readonly scope: GrantScope;
  readonly resource: string;
  readonly maxDuration: number;
  readonly maxOperations: number;
}

export interface AttenuatedGrantSetV1 {
  readonly schema: "werkstatt/attenuated-grant-set@1";
  readonly grants: readonly AttenuatedGrantV1[];
  readonly grantSetHash: Sha256Digest;
}

export interface WorkloadLimitsV1 {
  readonly maxMemoryBytes: number;
  readonly maxCpuTimeMs: number;
  readonly maxWallTimeMs: number;
  readonly maxConcurrency: number;
  readonly maxResponseBytes: number;
  readonly maxRequestBytes: number;
}

export interface CapabilityBridgeRequestV1 {
  readonly schema: "werkstatt/capability-bridge-request@1";
  readonly requestId: string;
  readonly capability: CapabilityId;
  readonly grant: AttenuatedGrantV1;
  readonly payload: Uint8Array;
  readonly deadline: number;
}

export interface CapabilityBridgeResponseV1 {
  readonly schema: "werkstatt/capability-bridge-response@1";
  readonly requestId: string;
  readonly status: "ok" | "denied" | "error" | "timeout";
  readonly payload: Uint8Array;
  readonly diagnostics: readonly string[];
}

export interface TerminationReportV1 {
  readonly schema: "werkstatt/termination-report@1";
  readonly workloadId: string;
  readonly reason: string;
  readonly terminated: boolean;
  readonly quarantined: boolean;
  readonly diagnostics: readonly string[];
}

export interface SandboxedWorkloadCreateV1 {
  readonly workloadId: string;
  readonly artifactHash: Sha256Digest;
  readonly grantSet: AttenuatedGrantSetV1;
  readonly limits: WorkloadLimitsV1;
  readonly bridgeSchemaHash: Sha256Digest;
  readonly idempotencyKey: string;
}

export interface SandboxedWorkloadV1 {
  readonly workloadId: string;
  invoke(request: CapabilityBridgeRequestV1): Promise<CapabilityBridgeResponseV1>;
  terminate(reason: string): Promise<TerminationReportV1>;
}

export interface IsolationAdapterV1 {
  readonly schema: "werkstatt/isolation-adapter@1";
  readonly adapterId: string;
  readonly properties: IsolationPropertyEvidenceV1;
  create(input: SandboxedWorkloadCreateV1): Promise<SandboxedWorkloadV1>;
}

export type IsolationConformanceStatus = "pass" | "fail" | "incomplete";

export type AdversarialCaseKind =
  | "filesystem-escape"
  | "network-escape"
  | "process-escape"
  | "environment-escape"
  | "credential-escape"
  | "descriptor-escape"
  | "resource-exhaustion"
  | "workload-separation"
  | "teardown"
  | "crash"
  | "bridge-confusion"
  | "bridge-replay"
  | "vm-theatre"
  | "worker-threads-theatre"
  | "subprocess-theatre";

export interface AdversarialCaseResultV1 {
  readonly caseKind: AdversarialCaseKind;
  readonly passed: boolean;
  readonly violations: readonly string[];
  readonly detail: string;
}

export interface IsolationConformanceResultV1 {
  readonly schema: "werkstatt/isolation-conformance-result@1";
  readonly adapterId: string;
  readonly propertyEvidenceHash: Sha256Digest;
  readonly grantSetHash: Sha256Digest;
  readonly fixtureHash: Sha256Digest;
  readonly cases: readonly AdversarialCaseResultV1[];
  readonly violations: readonly string[];
  readonly status: IsolationConformanceStatus;
  readonly testOnly: boolean;
}

export const REJECTED_ADAPTER_TIERS = new Set<AdversarialCaseKind>([
  "vm-theatre",
  "worker-threads-theatre",
  "subprocess-theatre",
]);

export const REQUIRED_PROPERTIES: readonly IsolationPropertyKind[] = [
  "containment",
  "clean-room-startup",
  "artifact-immutability",
  "grant-enforcement",
  "egress-controls",
  "resource-limits",
  "secret-non-inheritance",
  "teardown",
  "crash-recovery",
  "concurrent-workload-separation",
  "bridge-confusion-replay",
  "host-compromise-assumptions",
];
