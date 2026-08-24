import type { Sha256Digest } from "../../fingerprint/primitives.ts";
import type { Diagnostic } from "../../schemas/diagnostic.ts";
import type { EvidenceEnvelopeV1 } from "../contracts/evidence.ts";

export type RiskClass = "ordinary" | "critical" | "borderline";
export type EvaluatorVerdict = "pass" | "fail" | "borderline" | "incomplete";

export interface QualitativeRubricV1 {
  schema: "werkstatt/site-qualitative-rubric@1";
  rubricId: string;
  version: string;
  criteria: RubricCriterionV1[];
}

export interface RubricCriterionV1 {
  criterionId: string;
  title: string;
  description: string;
  dimension: string;
  weight: number;
}

export interface EvaluatorInputBundleV1 {
  schema: "werkstatt/evaluator-input-bundle@1";
  bundleId: string;
  candidateId: string;
  rubricId: string;
  rubricVersion: string;
  coverageManifest: CoverageManifestV1;
  deterministicEvidence: EvidenceEnvelopeV1[];
  changedRoutes: string[];
  changedStates: string[];
  redactedContent: string;
  bundleHash: Sha256Digest;
}

export interface CoverageManifestV1 {
  schema: "werkstatt/coverage-manifest@1";
  routes: string[];
  states: string[];
  viewports: string[];
  combinations: CoverageCombinationV1[];
}

export interface CoverageCombinationV1 {
  route: string;
  state: string;
  viewport: string;
  covered: boolean;
  evidenceId: string | null;
}

export interface QualitativeEvaluationPayloadV1 {
  schema: "werkstatt/site-qualitative-evaluation@1";
  evaluatorId: string;
  evaluatorRunId: string;
  modelProvider: string;
  modelVersion: string;
  rubricId: string;
  rubricVersion: string;
  inputBundleHash: Sha256Digest;
  riskClass: RiskClass;
  verdict: EvaluatorVerdict;
  confidence: number;
  criteria: CriterionVerdictV1[];
  diagnostics: Diagnostic[];
}

export interface CriterionVerdictV1 {
  criterionId: string;
  verdict: EvaluatorVerdict;
  rationale: string;
  diagnosticIds: string[];
  evidenceAnchors: string[];
}

export interface EvaluatorIdentityV1 {
  evaluatorId: string;
  modelProvider: string;
  modelVersion: string;
}

export type EvaluatorHandlerV1 = (
  input: EvaluatorInputBundleV1,
  identity: EvaluatorIdentityV1,
) => Promise<QualitativeEvaluationPayloadV1>;

export interface RegisteredEvaluatorV1 {
  identity: EvaluatorIdentityV1;
  handler: EvaluatorHandlerV1;
}

export interface EvaluatorRegistryV1 {
  register(identity: EvaluatorIdentityV1, handler: EvaluatorHandlerV1): EvaluatorRegisterOutcomeV1;
  get(evaluatorId: string): RegisteredEvaluatorV1 | null;
  list(): readonly string[];
}

export interface EvaluatorRegisterResultV1 {
  ok: true;
  evaluatorId: string;
}

export interface EvaluatorRegisterFailureV1 {
  ok: false;
  ruleId: "CERT-EVAL-01";
  message: string;
}

export type EvaluatorRegisterOutcomeV1 = EvaluatorRegisterResultV1 | EvaluatorRegisterFailureV1;

export function createEvaluatorRegistry(): EvaluatorRegistryV1 {
  const evaluators = new Map<string, RegisteredEvaluatorV1>();

  return {
    register(identity: EvaluatorIdentityV1, handler: EvaluatorHandlerV1): EvaluatorRegisterOutcomeV1 {
      if (evaluators.has(identity.evaluatorId)) {
        return {
          ok: false,
          ruleId: "CERT-EVAL-01",
          message: `evaluator "${identity.evaluatorId}" is already registered`,
        };
      }
      evaluators.set(identity.evaluatorId, { identity, handler });
      return { ok: true, evaluatorId: identity.evaluatorId };
    },

    get(evaluatorId: string): RegisteredEvaluatorV1 | null {
      return evaluators.get(evaluatorId) ?? null;
    },

    list(): readonly string[] {
      return [...evaluators.keys()];
    },
  };
}

export interface RiskRuleV1 {
  ruleId: string;
  dimension: string;
  description: string;
}

export interface RiskRoutingResultV1 {
  riskClass: RiskClass;
  requiredEvaluatorCount: number;
  matchedRules: RiskRuleV1[];
}

export function routeRisk(
  changeProfile: ChangeProfileV1,
  criticalRules: readonly RiskRuleV1[],
  borderlineRules: readonly RiskRuleV1[],
): RiskRoutingResultV1 {
  const matchedCritical: RiskRuleV1[] = [];
  for (const rule of criticalRules) {
    if (changeProfile.dimensions.includes(rule.dimension)) {
      matchedCritical.push(rule);
    }
  }

  if (matchedCritical.length > 0) {
    return {
      riskClass: "critical",
      requiredEvaluatorCount: 2,
      matchedRules: matchedCritical,
    };
  }

  const matchedBorderline: RiskRuleV1[] = [];
  for (const rule of borderlineRules) {
    if (changeProfile.dimensions.includes(rule.dimension)) {
      matchedBorderline.push(rule);
    }
  }

  if (matchedBorderline.length > 0) {
    return {
      riskClass: "borderline",
      requiredEvaluatorCount: 2,
      matchedRules: matchedBorderline,
    };
  }

  return {
    riskClass: "ordinary",
    requiredEvaluatorCount: 1,
    matchedRules: [],
  };
}

export interface ChangeProfileV1 {
  changedRoutes: string[];
  changedStates: string[];
  dimensions: string[];
  hasStructuralChanges: boolean;
  hasContentChanges: boolean;
  hasStyleChanges: boolean;
}

export interface EvaluatorIsolationCheckV1 {
  ok: true;
  passed: true;
}

export interface EvaluatorIsolationFailureV1 {
  ok: false;
  ruleId: "CERT-EVAL-02" | "CERT-EVAL-03" | "CERT-EVAL-04";
  message: string;
}

export type EvaluatorIsolationOutcomeV1 = EvaluatorIsolationCheckV1 | EvaluatorIsolationFailureV1;

export function checkEvaluatorIsolation(
  evaluatorIds: readonly string[],
  authorAgentId: string,
): EvaluatorIsolationOutcomeV1 {
  const seen = new Set<string>();
  for (const id of evaluatorIds) {
    if (id === authorAgentId) {
      return {
        ok: false,
        ruleId: "CERT-EVAL-02",
        message: `evaluator "${id}" matches author agent "${authorAgentId}" — self-review is not permitted`,
      };
    }
    if (seen.has(id)) {
      return {
        ok: false,
        ruleId: "CERT-EVAL-03",
        message: `duplicate evaluator identity "${id}" — distinct evaluator IDs are required`,
      };
    }
    seen.add(id);
  }

  return { ok: true, passed: true };
}

export interface ConsensusResultV1 {
  ok: true;
  consensus: "pass" | "fail" | "incomplete";
  verdicts: EvaluatorVerdict[];
}

export interface ConsensusFailureV1 {
  ok: false;
  ruleId: "CERT-EVAL-05" | "CERT-EVAL-06";
  message: string;
}

export type ConsensusOutcomeV1 = ConsensusResultV1 | ConsensusFailureV1;

export function aggregateConsensus(
  payloads: readonly QualitativeEvaluationPayloadV1[],
): ConsensusOutcomeV1 {
  if (payloads.length === 0) {
    return {
      ok: false,
      ruleId: "CERT-EVAL-05",
      message: "no evaluator payloads provided — missing runs map to incomplete",
    };
  }

  const verdicts = payloads.map((p) => p.verdict);
  const allPass = verdicts.every((v) => v === "pass");
  const allFail = verdicts.every((v) => v === "fail");

  if (allPass) {
    return { ok: true, consensus: "pass", verdicts };
  }

  if (allFail) {
    return { ok: true, consensus: "fail", verdicts };
  }

  return { ok: true, consensus: "incomplete", verdicts };
}

export interface EvaluatorValidationResultV1 {
  ok: true;
  passed: true;
}

export interface EvaluatorValidationFailureV1 {
  ok: false;
  ruleId: "CERT-EVAL-07" | "CERT-EVAL-08" | "CERT-EVAL-09" | "CERT-EVAL-10";
  message: string;
}

export type EvaluatorValidationOutcomeV1 = EvaluatorValidationResultV1 | EvaluatorValidationFailureV1;

export function validateEvaluatorPayload(
  payload: QualitativeEvaluationPayloadV1,
  expectedBundleHash: Sha256Digest,
  rubric: QualitativeRubricV1,
): EvaluatorValidationOutcomeV1 {
  if (payload.inputBundleHash !== expectedBundleHash) {
    return {
      ok: false,
      ruleId: "CERT-EVAL-07",
      message: `input bundle hash mismatch: expected ${expectedBundleHash}, got ${payload.inputBundleHash}`,
    };
  }

  if (payload.rubricId !== rubric.rubricId || payload.rubricVersion !== rubric.version) {
    return {
      ok: false,
      ruleId: "CERT-EVAL-08",
      message: `rubric mismatch: expected ${rubric.rubricId}@${rubric.version}, got ${payload.rubricId}@${payload.rubricVersion}`,
    };
  }

  if (payload.confidence < 0 || payload.confidence > 100) {
    return {
      ok: false,
      ruleId: "CERT-EVAL-09",
      message: `confidence ${payload.confidence} is out of range [0, 100]`,
    };
  }

  const rubricCriterionIds = new Set(rubric.criteria.map((c) => c.criterionId));
  for (const cv of payload.criteria) {
    if (!rubricCriterionIds.has(cv.criterionId)) {
      return {
        ok: false,
        ruleId: "CERT-EVAL-10",
        message: `criterion "${cv.criterionId}" is not in rubric "${rubric.rubricId}"`,
      };
    }
    if (!cv.rationale || cv.rationale.trim().length === 0) {
      return {
        ok: false,
        ruleId: "CERT-EVAL-10",
        message: `criterion "${cv.criterionId}" has empty rationale — ungrounded prose is not permitted`,
      };
    }
  }

  return { ok: true, passed: true };
}

export interface EvaluatorExecutionRequestV1 {
  evaluatorIds: readonly string[];
  inputBundle: EvaluatorInputBundleV1;
  authorAgentId: string;
  rubric: QualitativeRubricV1;
}

export interface EvaluatorExecutionSuccessV1 {
  ok: true;
  payloads: QualitativeEvaluationPayloadV1[];
  consensus: "pass" | "fail" | "incomplete";
}

export interface EvaluatorExecutionFailureV1 {
  ok: false;
  ruleId: "CERT-EVAL-11" | "CERT-EVAL-12" | "CERT-EVAL-13";
  message: string;
}

export type EvaluatorExecutionOutcomeV1 = EvaluatorExecutionSuccessV1 | EvaluatorExecutionFailureV1;

export async function executeEvaluators(
  registry: EvaluatorRegistryV1,
  request: EvaluatorExecutionRequestV1,
): Promise<EvaluatorExecutionOutcomeV1> {
  const isolationCheck = checkEvaluatorIsolation(request.evaluatorIds, request.authorAgentId);
  if (!isolationCheck.ok) {
    return {
      ok: false,
      ruleId: "CERT-EVAL-11",
      message: isolationCheck.message,
    };
  }

  const payloads: QualitativeEvaluationPayloadV1[] = [];
  for (const evaluatorId of request.evaluatorIds) {
    const registered = registry.get(evaluatorId);
    if (!registered) {
      return {
        ok: false,
        ruleId: "CERT-EVAL-12",
        message: `evaluator "${evaluatorId}" is not registered`,
      };
    }

    let payload: QualitativeEvaluationPayloadV1;
    try {
      payload = await registered.handler(request.inputBundle, registered.identity);
    } catch (err) {
      return {
        ok: false,
        ruleId: "CERT-EVAL-13",
        message: `evaluator "${evaluatorId}" threw: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const validation = validateEvaluatorPayload(
      payload,
      request.inputBundle.bundleHash,
      request.rubric,
    );
    if (!validation.ok) {
      return {
        ok: false,
        ruleId: "CERT-EVAL-13",
        message: validation.message,
      };
    }

    payloads.push(payload);
  }

  const consensusResult = aggregateConsensus(payloads);
  if (!consensusResult.ok) {
    return {
      ok: false,
      ruleId: "CERT-EVAL-13",
      message: consensusResult.message,
    };
  }

  return {
    ok: true,
    payloads,
    consensus: consensusResult.consensus,
  };
}

export function buildCoverageManifest(
  routes: readonly string[],
  states: readonly string[],
  viewports: readonly string[],
  evidence: readonly EvidenceEnvelopeV1[],
): CoverageManifestV1 {
  const evidenceByRoute = new Map<string, string>();
  for (const ev of evidence) {
    for (const reqId of ev.result.applicability.appliesTo) {
      evidenceByRoute.set(reqId, ev.evidenceId);
    }
  }

  const combinations: CoverageCombinationV1[] = [];
  for (const route of routes) {
    for (const state of states) {
      for (const viewport of viewports) {
        const key = `${route}::${state}::${viewport}`;
        const evidenceId = evidenceByRoute.get(key) ?? null;
        combinations.push({
          route,
          state,
          viewport,
          covered: evidenceId !== null,
          evidenceId,
        });
      }
    }
  }

  return {
    schema: "werkstatt/coverage-manifest@1",
    routes: [...routes],
    states: [...states],
    viewports: [...viewports],
    combinations,
  };
}
