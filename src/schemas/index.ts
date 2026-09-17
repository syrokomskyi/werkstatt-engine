/*
<MODULE_CONTRACT>
<purpose>
Barrel export for @warpgogol/werkstatt-engine/schemas sub-path.
Forwarding barrel — platform operations schemas sunk to
@warpgogol/werkstatt-shared/ontology/operations and diagnostic schemas to
@warpgogol/werkstatt-shared/kernel per RFC-1104. Preserves the
engine/schemas package specifier for existing consumers.
</purpose>
<non-goals>
  <item>Do not declare schemas here — canonical definitions live in werkstatt-shared.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1104: converted to forwarding barrel — operations schemas re-exported from werkstatt-shared/ontology/operations, diagnostic schemas from werkstatt-shared/kernel.</item>
</CHANGE_SUMMARY>
*/

// RFC-1104: platform operations schemas (handoff, sternsystem, werkstatt,
// mission, naming-policy, materialization, artifact-store, release,
// leitstand, notausgang, dht) sunk to werkstatt-shared.
export * from "@warpgogol/werkstatt-shared/ontology/operations";

// RFC-0852/RFC-1104: canonical Diagnostic schemas sunk to werkstatt-shared/kernel.
export {
  diagnosticSeveritySchema,
  diagnosticEvidenceSchema,
  diagnosticSchema,
  diagnosticRuleIdSchema,
  safeWorkspaceRelativePathSchema,
  safeDiagnosticUrlSchema,
  remediationRefSchema,
  DIAGNOSTIC_LIMITS,
} from "@warpgogol/werkstatt-shared/kernel";
export type {
  DiagnosticSeverity,
  DiagnosticEvidence,
  Diagnostic,
  RemediationRef,
} from "@warpgogol/werkstatt-shared/kernel";
