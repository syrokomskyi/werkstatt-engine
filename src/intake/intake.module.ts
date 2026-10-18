/*
<MODULE_CONTRACT>
<purpose>RFC-1281: lazy-loading kernel module for the werkstatt:intake/v1
contract surface — onboarding.intake.validate (INTAKE-01…11 bundle validation)
and onboarding.intake.schema.export (JSON Schema artifact producers vendor).</purpose>
<non-goals>
  <item>Do not re-export types or utilities — this module is a command registration point only.</item>
  <item>Do not register onboarding.* commands owned by other modules.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1281: initial intake module — onboarding.intake.validate + onboarding.intake.schema.export.</item>
  <item>RFC-1281: intake contract and onboarding.intake.validate</item>
  <item>RFC-1328: harden intake contract — publication safety + locale-native facts

AMD-005: isPublicPbpEntity gates every projection channel (compiler resolveProfile,
semantic-loader, Astro loaders); INTAKE-12..15 blocking rules (internal markers,
statementByLocale coverage, WebP rasters, closed palette); Unicode tokenizer +
evidence-id strip in family.detect; per-locale seed documents; w2 producer handoff.</item>
</CHANGE_SUMMARY>
*/

import type { ModuleExport } from "@warpgogol/werkstatt-shared/kernel";

export async function createIntakeModule(): Promise<ModuleExport> {
  const { runIntakeValidate } = await import("./intake-validate.ts");
  const { runIntakeSchemaExport } = await import("./intake-schema-export.ts");
  return {
    name: "intake",
    version: "0.1.0",
    declarations: [],
    commands: [
      {
        name: "onboarding.intake.validate",
        modulePath: "packages/werkstatt-engine/src/intake/intake.module.ts",
        description:
          "Validate a werkstatt:intake/v1 hand-over bundle (RFC-1281 + AMD-005/RFC-1328): manifest/hash integrity, envelope schema, PBP entities, referential integrity, verbatim quotes, gaps, locales, biome axes, assets, provenance, cost report, public-safe text, locale-native statements, WebP rasters, closed palette (INTAKE-01..15). Exactly one of `--id` or `--bundle` is required.",
        contract: "onboarding-intake",
        rules: [
          "INTAKE-01",
          "INTAKE-02",
          "INTAKE-03",
          "INTAKE-04",
          "INTAKE-05",
          "INTAKE-06",
          "INTAKE-07",
          "INTAKE-08",
          "INTAKE-09",
          "INTAKE-10",
          "INTAKE-11",
          "INTAKE-12",
          "INTAKE-13",
          "INTAKE-14",
          "INTAKE-15",
        ],
        scope: "workspace",
        flags: {
          id: {
            kind: "string",
            description:
              "Onboarding id — resolves onboarding/<id>/.input/intake/ inside the workspace.",
          },
          bundle: {
            kind: "string",
            description: "Bundle directory (repo-relative or absolute).",
          },
          "cost-budget-usd": {
            kind: "string",
            description: "Budget ceiling in USD for the INTAKE-11 warning (default 5).",
          },
        },
        mutatesState: false,
        // `--bundle` may point at any directory — declared reads cannot cover it,
        // so a cached result could be stale (same class as lagebild.validate).
        cacheable: false,
        coverage: "operator",
        coverageNote:
          "Runbook/acceptance invocation — producer hand-off is validated manually or via docs/rfcs RFC-1281 acceptance probes.",
        writes: [],
        generates: [],
        reads: ["onboarding/*/.input/intake/**"],
        requiresNetwork: false,
        execute: runIntakeValidate,
      },
      {
        name: "onboarding.intake.schema.export",
        modulePath: "packages/werkstatt-engine/src/intake/intake.module.ts",
        description:
          "Render the werkstatt:intake/v1 JSON Schema from the Zod model and write intake.schema.generated.yaml under an RFC-0336 header (RFC-1281). Producers vendor the file byte-exact; its sha256 is the provenance.contractSnapshot checked by INTAKE-10.",
        scope: "workspace",
        flags: {},
        mutatesState: true,
        coverage: "operator",
        coverageNote:
          "Runbook invocation — run before vendoring the schema into site-werkstatt or when intake.ts changes.",
        writes: ["packages/werkstatt-shared/src/onboarding/intake.schema.generated.yaml"],
        generates: [
          {
            path: "packages/werkstatt-shared/src/onboarding/intake.schema.generated.yaml",
            phase: "on-demand",
          },
        ],
        reads: [],
        requiresNetwork: false,
        execute: runIntakeSchemaExport,
      },
    ],
    pipelines: [],
  };
}
