import type {
  EvidenceEnvelopeV1,
  ResolvedRequirementV1,
  CertificationPolicyBundleV1,
} from "./contracts/index.ts";
import type { Sha256Digest } from "../fingerprint/primitives.ts";

export type CertificationLimitFailureV1 = {
  readonly ok: false;
  readonly code: "CERT-LIMIT-01" | "CERT-LIMIT-02" | "CERT-LIMIT-03";
  readonly message: string;
};

export type RequirementStatus =
  | "pass"
  | "fail"
  | "stale"
  | "incomplete"
  | "not-applicable";

export type EvidenceIndexInputV1 = {
  readonly candidateId: string;
  readonly evidence: readonly EvidenceEnvelopeV1[];
  readonly evaluationCutSequence: number;
};

export type EvidenceIndexEntryV1 = {
  readonly evidence: EvidenceEnvelopeV1;
  readonly evidenceHash: Sha256Digest;
};

export type EvidenceIndexV1 = {
  readonly candidateId: string;
  readonly evaluationCutSequence: number;
  readonly byRequirement: ReadonlyMap<string, EvidenceIndexEntryV1[]>;
  readonly totalCount: number;
};

export type RequirementEvidenceSelectionInputV1 = {
  readonly requirement: ResolvedRequirementV1;
  readonly policyBundle: CertificationPolicyBundleV1;
  readonly authorityTime: string;
};

export type RequirementEvidenceSelectionV1 = {
  readonly requirementId: string;
  readonly status: RequirementStatus;
  readonly selectedEvidenceId: string | null;
  readonly selectedEvidenceHash: Sha256Digest | null;
  readonly selectedAtSequence: number | null;
  readonly reasonCode:
    | "CERT-EVIDENCE-01"
    | "CERT-EVIDENCE-02"
    | "CERT-GATE-01"
    | "CERT-OK"
    | "CERT-NA";
  readonly reasonMessage: string;
};

const MAX_REQUIREMENTS = 1000;
const MAX_EVIDENCE = 10000;

export function buildEvidenceIndex(
  input: EvidenceIndexInputV1,
): EvidenceIndexV1 | CertificationLimitFailureV1 {
  if (input.evidence.length > MAX_EVIDENCE) {
    return {
      ok: false,
      code: "CERT-LIMIT-02",
      message: `evidence count ${input.evidence.length} exceeds hard limit ${MAX_EVIDENCE}`,
    };
  }

  const byRequirement = new Map<string, EvidenceIndexEntryV1[]>();
  let count = 0;

  for (const env of input.evidence) {
    if (env.candidateId !== input.candidateId) continue;
    const admission = env.authorityAdmission;
    if (!admission) continue;
    if (admission.authoritySequence > input.evaluationCutSequence) continue;

    const hash = env.result.bindingHash;
    const entry: EvidenceIndexEntryV1 = {
      evidence: env,
      evidenceHash: hash,
    };

    for (const reqId of env.result.applicability.appliesTo) {
      let list = byRequirement.get(reqId);
      if (!list) {
        list = [];
        byRequirement.set(reqId, list);
      }
      list.push(entry);
      count++;
    }
  }

  return {
    candidateId: input.candidateId,
    evaluationCutSequence: input.evaluationCutSequence,
    byRequirement,
    totalCount: count,
  };
}

function isFresh(env: EvidenceEnvelopeV1, authorityTime: string): boolean {
  return env.freshness.expiresAt >= authorityTime;
}

function isStale(env: EvidenceEnvelopeV1, authorityTime: string): boolean {
  return env.freshness.staleAfter < authorityTime;
}

function hasFailDiagnostic(env: EvidenceEnvelopeV1): boolean {
  return env.result.diagnostics.some((d) => d.severity === "error");
}

export function selectRequirementEvidence(
  input: RequirementEvidenceSelectionInputV1,
  index: EvidenceIndexV1,
): RequirementEvidenceSelectionV1 {
  const { requirement, authorityTime } = input;
  const entries = index.byRequirement.get(requirement.requirementId) ?? [];

  if (entries.length === 0) {
    if (!requirement.mandatory) {
      return {
        requirementId: requirement.requirementId,
        status: "not-applicable",
        selectedEvidenceId: null,
        selectedEvidenceHash: null,
        selectedAtSequence: null,
        reasonCode: "CERT-NA",
        reasonMessage: "no evidence and requirement is not mandatory",
      };
    }
    return {
      requirementId: requirement.requirementId,
      status: "incomplete",
      selectedEvidenceId: null,
      selectedEvidenceHash: null,
      selectedAtSequence: null,
      reasonCode: "CERT-EVIDENCE-01",
      reasonMessage: "no compatible admitted evidence at evaluation cut",
    };
  }

  let best: EvidenceIndexEntryV1 | null = null;
  let bestSeq = -1;

  for (const entry of entries) {
    const seq = entry.evidence.authorityAdmission?.authoritySequence ?? -1;
    if (seq > bestSeq) {
      bestSeq = seq;
      best = entry;
    }
  }

  if (!best) {
    return {
      requirementId: requirement.requirementId,
      status: "incomplete",
      selectedEvidenceId: null,
      selectedEvidenceHash: null,
      selectedAtSequence: null,
      reasonCode: "CERT-EVIDENCE-01",
      reasonMessage: "no admitted evidence with authority sequence",
    };
  }

  const env = best.evidence;

  if (hasFailDiagnostic(env)) {
    return {
      requirementId: requirement.requirementId,
      status: "fail",
      selectedEvidenceId: env.evidenceId,
      selectedEvidenceHash: best.evidenceHash,
      selectedAtSequence: bestSeq,
      reasonCode: "CERT-OK",
      reasonMessage: "admitted evidence contains error diagnostic",
    };
  }

  if (isStale(env, authorityTime)) {
    return {
      requirementId: requirement.requirementId,
      status: "stale",
      selectedEvidenceId: env.evidenceId,
      selectedEvidenceHash: best.evidenceHash,
      selectedAtSequence: bestSeq,
      reasonCode: "CERT-EVIDENCE-02",
      reasonMessage: "compatible evidence is stale for current binding",
    };
  }

  if (!isFresh(env, authorityTime)) {
    return {
      requirementId: requirement.requirementId,
      status: "stale",
      selectedEvidenceId: env.evidenceId,
      selectedEvidenceHash: best.evidenceHash,
      selectedAtSequence: bestSeq,
      reasonCode: "CERT-EVIDENCE-02",
      reasonMessage: "evidence freshness expired",
    };
  }

  return {
    requirementId: requirement.requirementId,
    status: "pass",
    selectedEvidenceId: env.evidenceId,
    selectedEvidenceHash: best.evidenceHash,
    selectedAtSequence: bestSeq,
    reasonCode: "CERT-OK",
    reasonMessage: "admitted current evidence passes",
  };
}

export const EVIDENCE_SELECTION_LIMITS = {
  MAX_REQUIREMENTS,
  MAX_EVIDENCE,
} as const;
