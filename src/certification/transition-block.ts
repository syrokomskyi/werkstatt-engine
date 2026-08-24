import type { Diagnostic } from "../schemas/diagnostic.ts";

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
