import type { Sha256Digest } from "../fingerprint/primitives.ts";
import { byteHash } from "../fingerprint/primitives.ts";
import type {
  CapabilityCandidateV1,
  EvolutionEvidenceBundleV1,
  TransitionRequestV1,
  BoundedIntentV1,
  KillSwitchStateV1,
} from "./contracts.ts";

export type GuardResultV1 = {
  ok: boolean;
  ruleId: string;
  message: string;
};

const FORBIDDEN_SELF_CHANGE_SCOPES = new Set([
  "law-kernel",
  "permissions",
  "effect-policy",
  "isolation-contract",
  "canonical-identity",
  "diagnostic-schema",
  "controller-code",
  "evaluator-policy",
]);

export function checkSelfChangeBoundary(intent: BoundedIntentV1): GuardResultV1 {
  if (FORBIDDEN_SELF_CHANGE_SCOPES.has(intent.scope)) {
    return {
      ok: false,
      ruleId: "CERT-EVO-GUARD-01",
      message: `controller cannot propose changes to forbidden scope "${intent.scope}" — requires human-governed RFC/program/release path`,
    };
  }
  return { ok: true, ruleId: "", message: "" };
}

export function checkEvidenceImmutability(
  candidate: CapabilityCandidateV1,
  evidence: EvolutionEvidenceBundleV1,
): GuardResultV1 {
  if (evidence.artifact.candidateHash !== candidate.artifactHash) {
    return {
      ok: false,
      ruleId: "CERT-EVO-GUARD-02",
      message: `evidence artifact candidate hash ${evidence.artifact.candidateHash} does not match candidate artifact hash ${candidate.artifactHash}`,
    };
  }

  if (evidence.artifact.parentHash !== candidate.parentArtifactHash) {
    return {
      ok: false,
      ruleId: "CERT-EVO-GUARD-03",
      message: `evidence artifact parent hash ${evidence.artifact.parentHash} does not match candidate parent hash ${candidate.parentArtifactHash}`,
    };
  }

  return { ok: true, ruleId: "", message: "" };
}

export function checkKillSwitch(killSwitch: KillSwitchStateV1): GuardResultV1 {
  if (killSwitch.active) {
    return {
      ok: false,
      ruleId: "CERT-EVO-GUARD-04",
      message: `kill switch is active: ${killSwitch.reason} — all transitions denied`,
    };
  }
  return { ok: true, ruleId: "", message: "" };
}

export function checkAuthorityExpiry(
  evidence: EvolutionEvidenceBundleV1,
  currentTimestamp: string,
): GuardResultV1 {
  if (evidence.authority.expiry <= currentTimestamp) {
    return {
      ok: false,
      ruleId: "CERT-EVO-GUARD-05",
      message: `authority evidence expired: expiry ${evidence.authority.expiry} <= current ${currentTimestamp}`,
    };
  }
  return { ok: true, ruleId: "", message: "" };
}

export function checkShadowSideEffects(evidence: EvolutionEvidenceBundleV1): GuardResultV1 {
  if (evidence.observation.exposure === "shadow") {
    if (evidence.observation.incidents.some((i) => i.severity === "critical")) {
      return {
        ok: false,
        ruleId: "CERT-EVO-GUARD-06",
        message: "shadow stage produced critical incident — side effects are forbidden in shadow",
      };
    }
  }
  return { ok: true, ruleId: "", message: "" };
}

export function checkCanaryBoundaries(
  evidence: EvolutionEvidenceBundleV1,
  maxCanaryDuration: number,
  minSampleSize: number,
): GuardResultV1 {
  if (evidence.observation.exposure !== "canary") {
    return { ok: true, ruleId: "", message: "" };
  }

  if (evidence.observation.duration > maxCanaryDuration) {
    return {
      ok: false,
      ruleId: "CERT-EVO-GUARD-07",
      message: `canary duration ${evidence.observation.duration} exceeds max ${maxCanaryDuration}`,
    };
  }

  if (evidence.observation.sampleSize < minSampleSize) {
    return {
      ok: false,
      ruleId: "CERT-EVO-GUARD-08",
      message: `canary sample size ${evidence.observation.sampleSize} below minimum ${minSampleSize}`,
    };
  }

  if (evidence.observation.uncertaintyScore > 0.3) {
    return {
      ok: false,
      ruleId: "CERT-EVO-GUARD-09",
      message: `canary uncertainty score ${evidence.observation.uncertaintyScore} exceeds threshold 0.3`,
    };
  }

  return { ok: true, ruleId: "", message: "" };
}

export function checkEvidencePoisoning(evidence: EvolutionEvidenceBundleV1): GuardResultV1 {
  const allHashes: string[] = [
    evidence.definition.evidenceHash,
    evidence.evaluation.evidenceHash,
    evidence.observation.evidenceHash,
    evidence.authority.evidenceHash,
    evidence.artifact.evidenceHash,
    evidence.bundleHash,
  ];

  const uniqueHashes = new Set(allHashes);
  if (uniqueHashes.size !== allHashes.length) {
    return {
      ok: false,
      ruleId: "CERT-EVO-GUARD-10",
      message: "evidence hash collision detected — possible evidence poisoning",
    };
  }

  const recomputedBundle = byteHash(
    JSON.stringify({
      definition: evidence.definition.evidenceHash,
      evaluation: evidence.evaluation.evidenceHash,
      observation: evidence.observation.evidenceHash,
      authority: evidence.authority.evidenceHash,
      artifact: evidence.artifact.evidenceHash,
    }),
  ) as Sha256Digest;

  if (recomputedBundle !== evidence.bundleHash) {
    return {
      ok: false,
      ruleId: "CERT-EVO-GUARD-11",
      message: `bundle hash mismatch: recomputed ${recomputedBundle} does not match declared ${evidence.bundleHash}`,
    };
  }

  return { ok: true, ruleId: "", message: "" };
}

export function runAllGuards(
  candidate: CapabilityCandidateV1,
  request: TransitionRequestV1,
  killSwitch: KillSwitchStateV1,
  currentTimestamp: string,
  maxCanaryDuration: number,
  minSampleSize: number,
): GuardResultV1 {
  const checks: GuardResultV1[] = [
    checkKillSwitch(killSwitch),
    checkEvidenceImmutability(candidate, request.evidence),
    checkAuthorityExpiry(request.evidence, currentTimestamp),
    checkShadowSideEffects(request.evidence),
    checkCanaryBoundaries(request.evidence, maxCanaryDuration, minSampleSize),
    checkEvidencePoisoning(request.evidence),
  ];

  for (const check of checks) {
    if (!check.ok) {
      return check;
    }
  }

  return { ok: true, ruleId: "", message: "" };
}
