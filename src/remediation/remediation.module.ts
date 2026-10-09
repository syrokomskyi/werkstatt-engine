/*
<MODULE_CONTRACT>
<purpose>
RFC-1027: registers remediation.catalog.generate and remediation.hint.validate
commands. The generate command emits docs/remediation-catalog.generated.yaml
from REMEDIATION_CATALOG. The validate command cross-references catalog keys
with validator rules[] declarations.
</purpose>
<non-goals>
  <item>Do not implement catalog or validation logic here — see remediation-catalog-generate.ts and remediation-hint-validate.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1027: initial implementation.</item>
  <item>RFC-1210: closed-loop signal ingest to bounded missions (RFC-1210)</item>
  <item>RFC-1231: step 1 — rename supportsAllSites to acceptsAllFlag

Mechanical sweep: the field only ever gated --all argv acceptance; fan-out
follows the parsed selector. Guard renamed assertAllSitesAllowed ->
assertAllFlagAccepted, message updated. 417 declaration sites + type
surfaces (KernelCommandMetadata, ForgeCommandMetadata) in one atomic pass.</item>
  <item>RFC-1248: VITE-CLIENT-DEP-02 lazy-import gate + SCAN-02 validator reads-root existence check (RFC-1248)</item>
</CHANGE_SUMMARY>
*/

import type { ModuleExport } from "@warpgogol/werkstatt-shared/kernel";

export async function createRemediationModule(): Promise<ModuleExport> {
  const { runRemediationCatalogGenerate } = await import("./remediation-catalog-generate.ts");
  const { runRemediationHintValidate } = await import("./remediation-hint-validate.ts");
  const { runRemediationSignalIngest } = await import("./remediation-signal-ingest.ts");
  return {
    name: "remediation",
    version: "0.1.0",

    declarations: [],
    commands: [
      {
        name: "remediation.catalog.generate",
        coverage: "operator" as const,
        modulePath: "packages/werkstatt-engine/src/remediation/remediation.module.ts",
        description:
          "Emit docs/remediation-catalog.generated.yaml from REMEDIATION_CATALOG, " +
          "cross-referencing validator rules[] declarations to identify uncovered ruleIds (RFC-1027).",
        scope: "workspace",
        mutatesState: true,
        writes: ["docs/remediation-catalog.generated.yaml"],
        cacheable: false,
        generates: [
          {
            path: "docs/remediation-catalog.generated.yaml",
            phase: "build.post",
          },
        ],
        flags: {},
        execute: runRemediationCatalogGenerate,
      },
      {
        name: "remediation.hint.validate",
        modulePath: "packages/werkstatt-engine/src/remediation/remediation.module.ts",
        description:
          "Validate that all validator diagnostics include remediation hints — " +
          "either via REMEDIATION_CATALOG or fixHint. In --mode strict, missing hints " +
          "are blocking errors (REMEDIATION-01). In --mode warning (default), they are warnings (RFC-1027).",
        scope: "workspace",
        mutatesState: false,
        cacheable: false,
        contract: "remediation",
        rules: ["REMEDIATION-01", "REMEDIATION-02"],
        flags: {
          mode: {
            kind: "string",
            description: "Validation mode: 'warning' (default) or 'strict'.",
          },
        },
        execute: runRemediationHintValidate,
      },
      {
        name: "remediation.signal.ingest",
        coverage: "operator" as const,
        modulePath: "packages/werkstatt-engine/src/remediation/remediation.module.ts",
        description:
          "Normalize and route a remediation signal (RFC-1210): --source is gated against the site's remediation.signalSources allowlist (SIG-02 blocking), unknown --class rejected (SIG-01), then dedup + daily rate cap decide between auto-mission | action-pack | suppressed-autonomy-off | deduped | rate-capped. Auto-missions open via the internal openRemediationMission step composing mission.open — there is intentionally no remediation.mission.open command. Required flags: --site, --class, --source.",
        scope: "workspace",
        acceptsAllFlag: false,
        mutatesState: true,
        generates: [],
        contract: "remediation-signal",
        rules: ["SIG-00", "SIG-01", "SIG-02", "SIG-03", "SIG-04", "SIG-05"],
        flags: {
          site: {
            kind: "string",
            required: true,
            description: "Sternsystem id the signal targets.",
          },
          class: {
            kind: "string",
            required: true,
            description: "Remediation class key from the closed REMEDIATION_CLASSES catalog.",
          },
          source: {
            kind: "string",
            required: true,
            description: "Invoker id — must be in the site's remediation.signalSources allowlist.",
          },
          "detected-by": {
            kind: "string",
            description:
              "Detector kind: signoz-alert | fleet-probe | check-runner | validator | manual (default).",
          },
          evidence: {
            kind: "string",
            description: "Evidence reference (path/url) or JSON array of references.",
          },
        },
        reads: [
          "../systems-cache/{system}/system-state.yaml",
          "../systems-cache/{system}/operations/remediation-signals.jsonl",
          "missions/*/mission.yaml",
        ],
        writes: [
          "../systems-cache/{system}/operations/remediation-signals.jsonl",
          "../systems-cache/{system}/bordbuch/events.ndjson",
          "missions/**",
        ],
        cacheable: false,
        execute: runRemediationSignalIngest,
      },
    ],
    pipelines: [],
  };
}
