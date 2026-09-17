/*
<MODULE_CONTRACT>
<purpose>transition-block — evaluate whether a certification state transition is blocked.</purpose>
<non-goals>
  <item>Do not transition — this module only reports block status.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

import type { Diagnostic } from "@warpgogol/werkstatt-shared/kernel";

export interface CertificationTransitionBlockResult {
  command: string;
  status: "incomplete";
  diagnostics: Diagnostic[];
  requiredNode: "CERT-007";
  exitCode: 1;
}

const TRANSITION_MESSAGE =
  "Site deployment is unavailable until the authority-backed certification transition is implemented.";
const TRANSITION_FIX_HINT =
  "Complete the accepted certification roadmap through CERT-007; no bypass is permitted.";

export function buildCertificationTransitionBlock(
  command: string,
): CertificationTransitionBlockResult {
  return {
    command,
    status: "incomplete",
    diagnostics: [
      {
        ruleId: "CERT-TRANSITION-01",
        severity: "error",
        message: TRANSITION_MESSAGE,
        fixHint: TRANSITION_FIX_HINT,
        evidence: [],
      },
    ],
    requiredNode: "CERT-007",
    exitCode: 1,
  };
}

export function isCertificationTransitionBlock(
  value: unknown,
): value is CertificationTransitionBlockResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    (value as { status: string }).status === "incomplete" &&
    "requiredNode" in value &&
    (value as { requiredNode: string }).requiredNode === "CERT-007" &&
    "diagnostics" in value &&
    Array.isArray((value as { diagnostics: unknown[] }).diagnostics) &&
    (value as { diagnostics: { ruleId: string }[] }).diagnostics.some(
      (d) => d?.ruleId === "CERT-TRANSITION-01",
    )
  );
}
