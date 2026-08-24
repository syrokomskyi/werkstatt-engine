import type {
  CertificationPolicyBundleV1,
  CoverageReportV1,
  SelectedEvidenceV1,
} from "./contracts/index.ts";
import type { Sha256Digest } from "../fingerprint/primitives.ts";
import {
  buildEvidenceIndex,
  selectRequirementEvidence,
  type RequirementStatus,
} from "./evidence-selection.ts";

export type CertificationEvaluationInputV1 = {
  readonly candidateId: string;
  readonly policyBundle: CertificationPolicyBundleV1;
  readonly evidence: readonly import("./contracts/index.ts").EvidenceEnvelopeV1[];
  readonly evaluationCutSequence: number;
  readonly authorityTime: string;
  readonly gate: "dev" | "alt" | "main";
  readonly decidedAt: string;
};

export type RequirementEvaluationV1 = {
  readonly requirementId: string;
  readonly status: RequirementStatus;
  readonly selectedEvidenceId: string | null;
  readonly selectedEvidenceHash: Sha256Digest | null;
  readonly reasonCode: string;
  readonly reasonMessage: string;
};

export type CertificationEvaluationResultV1 =
  | {
      readonly ok: true;
      readonly candidateId: string;
      readonly gate: "dev" | "alt" | "main";
      readonly evaluationCut: number;
      readonly status: "pass" | "fail" | "stale" | "incomplete";
      readonly requirements: readonly RequirementEvaluationV1[];
      readonly selectedEvidence: readonly SelectedEvidenceV1[];
      readonly coverage: CoverageReportV1;
      readonly reasons: readonly string[];
    }
  | {
      readonly ok: false;
      readonly code: "CERT-LIMIT-01" | "CERT-LIMIT-02" | "CERT-GATE-02";
      readonly message: string;
    };

const STATUS_PRECEDENCE: Record<string, number> = {
  fail: 4,
  stale: 3,
  incomplete: 2,
  pass: 1,
  "not-applicable": 0,
};

function aggregateStatus(
  statuses: readonly RequirementStatus[],
): "pass" | "fail" | "stale" | "incomplete" {
  if (statuses.length === 0) return "incomplete";
  let worst: RequirementStatus = "pass";
  for (const s of statuses) {
    if (s === "not-applicable") continue;
    if (STATUS_PRECEDENCE[s] > STATUS_PRECEDENCE[worst]) {
      worst = s;
    }
  }
  return worst as "pass" | "fail" | "stale" | "incomplete";
}

export function evaluateCertificationDecision(
  input: CertificationEvaluationInputV1,
): CertificationEvaluationResultV1 {
  if (input.policyBundle.resolvedRequirements.length > 1000) {
    return {
      ok: false,
      code: "CERT-LIMIT-01",
      message: `requirements count ${input.policyBundle.resolvedRequirements.length} exceeds hard limit 1000`,
    };
  }

  if (input.evidence.length > 10000) {
    return {
      ok: false,
      code: "CERT-LIMIT-02",
      message: `evidence count ${input.evidence.length} exceeds hard limit 10000`,
    };
  }

  const indexResult = buildEvidenceIndex({
    candidateId: input.candidateId,
    evidence: input.evidence,
    evaluationCutSequence: input.evaluationCutSequence,
  });

  if ("code" in indexResult) {
    return {
      ok: false,
      code: indexResult.code as "CERT-LIMIT-01" | "CERT-LIMIT-02",
      message: indexResult.message,
    };
  }

  const index = indexResult;

  const requirementResults: RequirementEvaluationV1[] = [];
  const selectedEvidence: SelectedEvidenceV1[] = [];
  const uncovered: string[] = [];
  const seenEvidenceIds = new Set<string>();
  const reasons: string[] = [];

  for (const req of input.policyBundle.resolvedRequirements) {
    const sel = selectRequirementEvidence(
      {
        requirement: req,
        policyBundle: input.policyBundle,
        authorityTime: input.authorityTime,
      },
      index,
    );

    requirementResults.push({
      requirementId: sel.requirementId,
      status: sel.status,
      selectedEvidenceId: sel.selectedEvidenceId,
      selectedEvidenceHash: sel.selectedEvidenceHash,
      reasonCode: sel.reasonCode,
      reasonMessage: sel.reasonMessage,
    });

    if (sel.selectedEvidenceId && !seenEvidenceIds.has(sel.selectedEvidenceId)) {
      seenEvidenceIds.add(sel.selectedEvidenceId);
      if (sel.selectedEvidenceHash) {
        selectedEvidence.push({
          evidenceId: sel.selectedEvidenceId,
          evidenceHash: sel.selectedEvidenceHash,
          selectedAt: input.authorityTime,
        });
      }
    }

    if (req.mandatory && sel.status !== "pass" && sel.status !== "not-applicable") {
      uncovered.push(req.requirementId);
      reasons.push(`${req.requirementId}: ${sel.reasonMessage}`);
    }
  }

  selectedEvidence.sort((a, b) =>
    a.evidenceId < b.evidenceId ? -1 : a.evidenceId > b.evidenceId ? 1 : 0,
  );

  const mandatoryStatuses = requirementResults
    .filter((r) => {
      const req = input.policyBundle.resolvedRequirements.find(
        (rr) => rr.requirementId === r.requirementId,
      );
      return req?.mandatory;
    })
    .map((r) => r.status);

  const hasMandatory = input.policyBundle.resolvedRequirements.some((r) => r.mandatory);

  if (!hasMandatory) {
    return {
      ok: true,
      candidateId: input.candidateId,
      gate: input.gate,
      evaluationCut: input.evaluationCutSequence,
      status: "incomplete",
      requirements: requirementResults,
      selectedEvidence,
      coverage: {
        schema: "werkstatt/coverage-report@1",
        totalRequirements: input.policyBundle.resolvedRequirements.length,
        coveredRequirements: input.policyBundle.resolvedRequirements.length - uncovered.length,
        uncoveredRequirements: uncovered,
      },
      reasons: ["no mandatory requirements — cannot infer pass from empty profile"],
    };
  }

  const status = aggregateStatus(mandatoryStatuses);

  return {
    ok: true,
    candidateId: input.candidateId,
    gate: input.gate,
    evaluationCut: input.evaluationCutSequence,
    status,
    requirements: requirementResults,
    selectedEvidence,
    coverage: {
      schema: "werkstatt/coverage-report@1",
      totalRequirements: input.policyBundle.resolvedRequirements.length,
      coveredRequirements: input.policyBundle.resolvedRequirements.length - uncovered.length,
      uncoveredRequirements: uncovered,
    },
    reasons,
  };
}
