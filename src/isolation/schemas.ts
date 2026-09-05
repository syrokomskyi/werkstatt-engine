import { z } from "zod";
import type { Sha256Digest } from "../fingerprint/primitives.ts";

const sha256Regex = /^sha256:[0-9a-f]{64}$/;

const sha256Schema = z.string().regex(sha256Regex) as unknown as z.ZodType<Sha256Digest>;

const isolationPropertyKindSchema = z.enum([
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
]);

export const isolationPropertyEvidenceV1Schema = z
  .object({
    schema: z.literal("werkstatt/isolation-property-evidence@1"),
    properties: z
      .array(
        z
          .object({
            kind: isolationPropertyKindSchema,
            proven: z.boolean(),
            evidenceHash: sha256Schema,
            description: z.string().min(1).max(4096),
          })
          .strict(),
      )
      .max(64),
    unsupported: z.array(isolationPropertyKindSchema).max(32),
  })
  .strict();

const grantScopeSchema = z.enum(["read", "append", "deploy", "certify", "administer"]);

export const attenuatedGrantV1Schema = z
  .object({
    scope: grantScopeSchema,
    resource: z.string().min(1).max(1024),
    maxDuration: z.number().int().nonnegative(),
    maxOperations: z.number().int().nonnegative(),
  })
  .strict();

export const attenuatedGrantSetV1Schema = z
  .object({
    schema: z.literal("werkstatt/attenuated-grant-set@1"),
    grants: z.array(attenuatedGrantV1Schema).max(256),
    grantSetHash: sha256Schema,
  })
  .strict();

export const workloadLimitsV1Schema = z
  .object({
    maxMemoryBytes: z.number().int().positive(),
    maxCpuTimeMs: z.number().int().positive(),
    maxWallTimeMs: z.number().int().positive(),
    maxConcurrency: z.number().int().positive(),
    maxResponseBytes: z.number().int().positive(),
    maxRequestBytes: z.number().int().positive(),
  })
  .strict();

const capabilityIdSchema = z.string().regex(/^[a-z0-9-]+\/[a-z0-9-]+$/);

export const capabilityBridgeRequestV1Schema = z
  .object({
    schema: z.literal("werkstatt/capability-bridge-request@1"),
    requestId: z.string().min(1).max(128),
    capability: capabilityIdSchema,
    grant: attenuatedGrantV1Schema,
    payload: z.instanceof(Uint8Array),
    deadline: z.number().int().positive(),
  })
  .strict();

export const capabilityBridgeResponseV1Schema = z
  .object({
    schema: z.literal("werkstatt/capability-bridge-response@1"),
    requestId: z.string().min(1).max(128),
    status: z.enum(["ok", "denied", "error", "timeout"]),
    payload: z.instanceof(Uint8Array),
    diagnostics: z.array(z.string().max(4096)).max(128),
  })
  .strict();

export const terminationReportV1Schema = z
  .object({
    schema: z.literal("werkstatt/termination-report@1"),
    workloadId: z.string().min(1).max(128),
    reason: z.string().min(1).max(4096),
    terminated: z.boolean(),
    quarantined: z.boolean(),
    diagnostics: z.array(z.string().max(4096)).max(128),
  })
  .strict();

export const sandboxedWorkloadCreateV1Schema = z
  .object({
    workloadId: z.string().min(1).max(128),
    artifactHash: sha256Schema,
    grantSet: attenuatedGrantSetV1Schema,
    limits: workloadLimitsV1Schema,
    bridgeSchemaHash: sha256Schema,
    idempotencyKey: z.string().min(1).max(128),
  })
  .strict();

const adversarialCaseKindSchema = z.enum([
  "filesystem-escape",
  "network-escape",
  "process-escape",
  "environment-escape",
  "credential-escape",
  "descriptor-escape",
  "resource-exhaustion",
  "workload-separation",
  "teardown",
  "crash",
  "bridge-confusion",
  "bridge-replay",
  "vm-theatre",
  "worker-threads-theatre",
  "subprocess-theatre",
]);

export const adversarialCaseResultV1Schema = z
  .object({
    caseKind: adversarialCaseKindSchema,
    passed: z.boolean(),
    violations: z.array(z.string().max(4096)).max(128),
    detail: z.string().max(4096),
  })
  .strict();

export const isolationConformanceResultV1Schema = z
  .object({
    schema: z.literal("werkstatt/isolation-conformance-result@1"),
    adapterId: z.string().min(1).max(128),
    propertyEvidenceHash: sha256Schema,
    grantSetHash: sha256Schema,
    fixtureHash: sha256Schema,
    cases: z.array(adversarialCaseResultV1Schema).max(64),
    violations: z.array(z.string().max(4096)).max(256),
    status: z.enum(["pass", "fail", "incomplete"]),
    testOnly: z.literal(true),
  })
  .strict();

export const isolationAdapterV1Schema = z
  .object({
    schema: z.literal("werkstatt/isolation-adapter@1"),
    adapterId: z.string().min(1).max(128),
    properties: isolationPropertyEvidenceV1Schema,
  })
  .strict();

export type IsolationContractViolation = {
  readonly rule: string;
  readonly path: string;
  readonly message: string;
};

export function validateIsolationAdapter(adapter: unknown): {
  status: "pass" | "fail";
  violations: IsolationContractViolation[];
} {
  if (typeof adapter === "object" && adapter !== null && "create" in adapter) {
    const { create: _create, ...dataFields } = adapter as Record<string, unknown>;
    const result = isolationAdapterV1Schema.safeParse(dataFields);
    if (result.success) {
      return { status: "pass", violations: [] };
    }
    const violations: IsolationContractViolation[] = result.error.issues.map((issue) => ({
      rule: `ISOLATION-${issue.code}`,
      path: issue.path.join("."),
      message: issue.message,
    }));
    return { status: "fail", violations };
  }
  const result = isolationAdapterV1Schema.safeParse(adapter);
  if (result.success) {
    return { status: "pass", violations: [] };
  }
  const violations: IsolationContractViolation[] = result.error.issues.map((issue) => ({
    rule: `ISOLATION-${issue.code}`,
    path: issue.path.join("."),
    message: issue.message,
  }));
  return { status: "fail", violations };
}

export function validateBridgeRequest(request: unknown): {
  status: "pass" | "fail";
  violations: IsolationContractViolation[];
} {
  const result = capabilityBridgeRequestV1Schema.safeParse(request);
  if (result.success) {
    return { status: "pass", violations: [] };
  }
  const violations: IsolationContractViolation[] = result.error.issues.map((issue) => ({
    rule: `ISOLATION-BRIDGE-${issue.code}`,
    path: issue.path.join("."),
    message: issue.message,
  }));
  return { status: "fail", violations };
}
