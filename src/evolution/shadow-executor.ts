/*
<MODULE_CONTRACT>
<purpose>RFC-1031: Shadow execution engine — runs candidate alongside active
  component in parallel, compares results, and records CandidateEvidenceV1.</purpose>
<non-goals>
  <item>Does not route traffic — that is the canary router's job.</item>
  <item>Does not make promotion decisions — the agent evaluates the evidence.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1031: initial implementation — shadow executor for parallel invocation and comparison.</item>
</CHANGE_SUMMARY>
*/

import type { Sha256Digest } from "../fingerprint/primitives.ts";
import { byteHash } from "../fingerprint/primitives.ts";
import type { CandidateEvidenceV1 } from "./contracts.ts";

export interface ShadowExecutor {
  execute(
    candidateId: string,
    comparisonMetric: string,
    candidateFn: (input: unknown) => unknown,
    activeFn: (input: unknown) => unknown,
    input: unknown,
  ): Promise<CandidateEvidenceV1>;
}

export function createShadowExecutor(): ShadowExecutor {
  return {
    async execute(
      candidateId: string,
      comparisonMetric: string,
      candidateFn: (input: unknown) => unknown,
      activeFn: (input: unknown) => unknown,
      input: unknown,
    ): Promise<CandidateEvidenceV1> {
      const canonicalInput = JSON.stringify(input);
      const scenarioHash = byteHash(canonicalInput) as Sha256Digest;

      const [candidateResult, activeResult] = await Promise.all([
        Promise.resolve(candidateFn(input)),
        Promise.resolve(activeFn(input)),
      ]);

      const candidateValue = typeof candidateResult === "number" ? candidateResult : 0;
      const activeValue = typeof activeResult === "number" ? activeResult : 0;
      const delta = candidateValue - activeValue;

      return {
        schema: "werkstatt/candidate-evidence@1",
        phase: "shadow",
        metric: comparisonMetric,
        candidateValue,
        activeValue,
        delta,
        timestamp: new Date().toISOString(),
        scenarioHash,
      };
    },
  };
}
