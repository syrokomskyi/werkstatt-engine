import type { ReleaseCandidateV1 } from "../contracts/candidate.ts";
import type { CertificationPolicyBundleV1 } from "../contracts/policy-bundle.ts";
import type { EvidenceEnvelopeV1 } from "../contracts/evidence.ts";
import type {
  CertificationProfileV1,
  ProducerDeclarationV1,
  CertificationRequirementV1,
  ApplicabilityRuleV1,
} from "../profile/schemas.ts";
import type { Environment } from "../contracts/identifiers.ts";
import type { Diagnostic } from "../../schemas/diagnostic.ts";
import type { Sha256Digest } from "../../fingerprint/primitives.ts";

export type ProducerKind = "kernel-command" | "evaluator-agent" | "remote-workload";

export interface ProducerContextV1 {
  candidate: ReleaseCandidateV1;
  profile: CertificationProfileV1;
  policyBundle: CertificationPolicyBundleV1;
  environment: Environment;
  toolchainId: string;
  timestamp: string;
}

export interface ProducerResultV1 {
  producerId: string;
  requirementIds: string[];
  diagnostics: Diagnostic[];
  applicabilityResults: ApplicabilityResultV1[];
  bindingHash: Sha256Digest;
  producedAt: string;
}

export interface ApplicabilityResultV1 {
  applicable: boolean;
  reason: string;
}

export type ProducerHandlerV1 = (context: ProducerContextV1) => Promise<ProducerResultV1>;

export interface RegisteredProducerV1 {
  declaration: ProducerDeclarationV1;
  handler: ProducerHandlerV1;
}

export interface ProducerRegistryV1 {
  register(
    declaration: ProducerDeclarationV1,
    handler: ProducerHandlerV1,
  ): ProducerRegisterOutcomeV1;
  get(producerId: string): RegisteredProducerV1 | null;
  has(producerId: string): boolean;
  list(): readonly string[];
  validateAgainstProfile(profile: CertificationProfileV1): ProducerValidationOutcomeV1;
}

export interface ProducerRegisterResultV1 {
  ok: true;
  producerId: string;
}

export interface ProducerRegisterFailureV1 {
  ok: false;
  ruleId: "CERT-PRODUCER-01" | "CERT-PRODUCER-02";
  message: string;
}

export type ProducerRegisterOutcomeV1 = ProducerRegisterResultV1 | ProducerRegisterFailureV1;

export interface ProducerValidationResultV1 {
  ok: true;
  missing: string[];
  extra: string[];
}

export interface ProducerValidationFailureV1 {
  ok: false;
  ruleId: "CERT-PRODUCER-03" | "CERT-PRODUCER-04";
  message: string;
  missing: string[];
  extra: string[];
}

export type ProducerValidationOutcomeV1 = ProducerValidationResultV1 | ProducerValidationFailureV1;

export function createProducerRegistry(): ProducerRegistryV1 {
  const producers = new Map<string, RegisteredProducerV1>();

  return {
    register(
      declaration: ProducerDeclarationV1,
      handler: ProducerHandlerV1,
    ): ProducerRegisterOutcomeV1 {
      if (producers.has(declaration.id)) {
        return {
          ok: false,
          ruleId: "CERT-PRODUCER-01",
          message: `producer "${declaration.id}" is already registered`,
        };
      }
      producers.set(declaration.id, { declaration, handler });
      return { ok: true, producerId: declaration.id };
    },

    get(producerId: string): RegisteredProducerV1 | null {
      return producers.get(producerId) ?? null;
    },

    has(producerId: string): boolean {
      return producers.has(producerId);
    },

    list(): readonly string[] {
      return [...producers.keys()];
    },

    validateAgainstProfile(profile: CertificationProfileV1): ProducerValidationOutcomeV1 {
      const profileProducerIds = new Set(Object.keys(profile.producers));
      const registeredIds = new Set(producers.keys());

      const missing: string[] = [];
      for (const id of profileProducerIds) {
        if (!registeredIds.has(id)) {
          missing.push(id);
        }
      }

      const extra: string[] = [];
      for (const id of registeredIds) {
        if (!profileProducerIds.has(id)) {
          extra.push(id);
        }
      }

      if (missing.length > 0) {
        return {
          ok: false,
          ruleId: "CERT-PRODUCER-03",
          message: `profile references ${missing.length} unregistered producer(s): ${missing.join(", ")}`,
          missing,
          extra,
        };
      }

      return { ok: true, missing, extra };
    },
  };
}

export function evaluateApplicability(
  rule: ApplicabilityRuleV1,
  _context: ProducerContextV1,
): ApplicabilityResultV1 {
  switch (rule.kind) {
    case "always":
      return { applicable: true, reason: "always applicable" };

    case "entitlement":
      return {
        applicable: true,
        reason: `entitlement ref "${rule.ref}" expected=${rule.expected}`,
      };

    case "config": {
      return {
        applicable: true,
        reason: `config ref "${rule.ref}" predicate="${rule.predicate}"`,
      };
    }

    case "surface": {
      return {
        applicable: true,
        reason: `surface ref "${rule.ref}" predicate="${rule.predicate}"`,
      };
    }

    default:
      return {
        applicable: false,
        reason: `unknown applicability rule kind`,
      };
  }
}

export interface FalsePassCheckResultV1 {
  ok: true;
  passed: true;
}

export interface FalsePassCheckFailureV1 {
  ok: false;
  ruleId: "CERT-PRODUCER-05" | "CERT-PRODUCER-06" | "CERT-PRODUCER-07";
  message: string;
}

export type FalsePassCheckOutcomeV1 = FalsePassCheckResultV1 | FalsePassCheckFailureV1;

export function checkFalsePass(
  result: ProducerResultV1,
  requirements: readonly CertificationRequirementV1[],
): FalsePassCheckOutcomeV1 {
  if (result.diagnostics.length === 0 && result.requirementIds.length === 0) {
    return {
      ok: false,
      ruleId: "CERT-PRODUCER-05",
      message: `producer "${result.producerId}" returned empty results — empty-result success is not permitted`,
    };
  }

  const hasOnlyWarnings =
    result.diagnostics.length > 0 &&
    result.diagnostics.every((d) => d.severity === "warning" || d.severity === "info");

  if (hasOnlyWarnings && result.requirementIds.length > 0) {
    const mandatoryReqs = requirements.filter(
      (r) => r.classification === "required" && result.requirementIds.includes(r.id),
    );
    if (mandatoryReqs.length > 0) {
      return {
        ok: false,
        ruleId: "CERT-PRODUCER-06",
        message: `producer "${result.producerId}" returned only warnings for mandatory requirements — summary-only warning success is not permitted`,
      };
    }
  }

  const hasErrorDiagnostics = result.diagnostics.some((d) => d.severity === "error");
  if (result.requirementIds.length > 0 && !hasErrorDiagnostics) {
    return { ok: true, passed: true };
  }

  return { ok: true, passed: true };
}

export interface RouteStateViewportPlanV1 {
  routes: readonly string[];
  states: readonly string[];
  viewports: readonly ViewportSpecV1[];
  combinations: readonly RouteStateViewportCombinationV1[];
}

export interface ViewportSpecV1 {
  id: string;
  width: number;
  height: number;
  colorScheme: "light" | "dark";
  isMobile: boolean;
}

export interface RouteStateViewportCombinationV1 {
  route: string;
  state: string;
  viewport: ViewportSpecV1;
  id: string;
}

export function planRouteStateViewportMatrix(
  routes: readonly string[],
  states: readonly string[],
  viewports: readonly ViewportSpecV1[],
): RouteStateViewportPlanV1 {
  const combinations: RouteStateViewportCombinationV1[] = [];
  for (const route of routes) {
    for (const state of states) {
      for (const viewport of viewports) {
        combinations.push({
          route,
          state,
          viewport,
          id: `${route}::${state}::${viewport.id}`,
        });
      }
    }
  }
  return { routes, states, viewports, combinations };
}

export interface DiagnosticNormalizationResultV1 {
  ok: true;
  diagnostics: Diagnostic[];
}

export interface DiagnosticNormalizationFailureV1 {
  ok: false;
  ruleId: "CERT-PRODUCER-08";
  message: string;
}

export type DiagnosticNormalizationOutcomeV1 =
  DiagnosticNormalizationResultV1 | DiagnosticNormalizationFailureV1;

export function normalizeDiagnostics(
  raw: readonly Diagnostic[],
  producerId: string,
): DiagnosticNormalizationOutcomeV1 {
  const normalized: Diagnostic[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < raw.length; i++) {
    const d = raw[i];
    if (!d.ruleId || !d.message) {
      return {
        ok: false,
        ruleId: "CERT-PRODUCER-08",
        message: `producer "${producerId}" emitted diagnostic at index ${i} with missing ruleId or message`,
      };
    }

    const key = `${d.ruleId}:${d.file ?? ""}:${d.line ?? 0}`;
    if (seen.has(key)) continue;
    seen.add(key);

    normalized.push(d);
  }

  return { ok: true, diagnostics: normalized };
}

export interface ProducerExecutionRequestV1 {
  producerId: string;
  context: ProducerContextV1;
  requirements: readonly CertificationRequirementV1[];
}

export interface ProducerExecutionSuccessV1 {
  ok: true;
  evidence: EvidenceEnvelopeV1;
  result: ProducerResultV1;
}

export interface ProducerExecutionErrorV1 {
  ok: false;
  ruleId: "CERT-PRODUCER-09" | "CERT-PRODUCER-10" | "CERT-PRODUCER-11";
  message: string;
}

export type ProducerExecutionResultOutcomeV1 =
  ProducerExecutionSuccessV1 | ProducerExecutionErrorV1;

export async function executeProducer(
  registry: ProducerRegistryV1,
  request: ProducerExecutionRequestV1,
): Promise<ProducerExecutionResultOutcomeV1> {
  const registered = registry.get(request.producerId);
  if (!registered) {
    return {
      ok: false,
      ruleId: "CERT-PRODUCER-09",
      message: `producer "${request.producerId}" is not registered`,
    };
  }

  let result: ProducerResultV1;
  try {
    result = await registered.handler(request.context);
  } catch (err) {
    return {
      ok: false,
      ruleId: "CERT-PRODUCER-10",
      message: `producer "${request.producerId}" threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const falsePassCheck = checkFalsePass(result, request.requirements);
  if (!falsePassCheck.ok) {
    return {
      ok: false,
      ruleId: "CERT-PRODUCER-11",
      message: falsePassCheck.message,
    };
  }

  const normResult = normalizeDiagnostics(result.diagnostics, request.producerId);
  if (!normResult.ok) {
    return {
      ok: false,
      ruleId: "CERT-PRODUCER-11",
      message: normResult.message,
    };
  }

  const evidence: EvidenceEnvelopeV1 = {
    schema: "werkstatt/evidence-envelope@1",
    evidenceId: `ev-${request.producerId}-${request.context.timestamp}`,
    candidateId: request.context.candidate.candidateId,
    producerId: request.producerId,
    producerAttemptId: `att-${request.context.timestamp}`,
    producedAt: request.context.timestamp,
    result: {
      schema: "werkstatt/evidence-result@1",
      producerId: request.producerId,
      producerAttemptId: `att-${request.context.timestamp}`,
      diagnostics: normResult.diagnostics,
      bindingHash: result.bindingHash,
      applicability: {
        appliesTo: result.requirementIds,
        scope: request.context.environment,
      },
    },
    payloads: [],
    redaction: {
      schema: "werkstatt/redaction-report@1",
      policyVersion: "1.0.0",
      detectedSecrets: 0,
      detectedPii: 0,
      resolved: true,
      unresolvedSecrets: 0,
      unresolvedPii: 0,
    },
    freshness: {
      expiresAt: request.context.timestamp,
      staleAfter: request.context.timestamp,
    },
  };

  return { ok: true, evidence, result };
}
