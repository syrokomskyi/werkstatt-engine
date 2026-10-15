/*
<MODULE_CONTRACT>
<purpose>onboarding.intake.schema.export (RFC-1281): render the
werkstatt:intake/v1 JSON Schema from the Zod source-of-truth model
(renderIntakeSchemaExport) and write the vendored artifact
packages/werkstatt-shared/src/onboarding/intake.schema.generated.yaml under an
RFC-0336 advisory header naming this command as owner. Producers vendor the
file byte-exact and record its sha256 in provenance.contractSnapshot — the
value INTAKE-10 compares against.</purpose>
<non-goals>
  <item>Do not hand-edit the artifact — the Zod model is the source of truth (spec D2).</item>
  <item>Do not emit JSON — the contract's persisted form is YAML (AMD-001 §1, RFC-0376).</item>
</non-goals>
<CHANGE_SUMMARY>
  <item>RFC-1281: created — onboarding.intake.schema.export command.</item>
  <item>RFC-1281: intake contract and onboarding.intake.validate</item>
</CHANGE_SUMMARY>
*/

import { join } from "node:path";

import { renderIntakeSchemaExport } from "@warpgogol/werkstatt-shared/onboarding/intake";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-shared/kernel";

import { buildGeneratedHeader } from "../kernel/generated-marker.ts";

/** Repo-relative path of the vendored schema export (INTAKE-10 input). */
export const INTAKE_SCHEMA_EXPORT_PATH =
  "packages/werkstatt-shared/src/onboarding/intake.schema.generated.yaml";

export interface IntakeSchemaExportResult {
  command: "onboarding.intake.schema.export";
  status: "pass";
  path: string;
  bytes: number;
  dryRun: boolean;
  /** Rendered content map consumed by generated.drift.validate dryRun re-render. */
  renderedFiles?: Record<string, string>;
}

export async function runIntakeSchemaExport(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<IntakeSchemaExportResult>> {
  const content =
    buildGeneratedHeader({
      filePath: INTAKE_SCHEMA_EXPORT_PATH,
      ownerCommand: "onboarding.intake.schema.export",
    }) + renderIntakeSchemaExport();

  const dryRun = context.dryRun === true || input.flags["dry-run"] === true;
  if (!dryRun) {
    await context.io.writeFile(join(context.workspaceRoot, INTAKE_SCHEMA_EXPORT_PATH), content);
  }

  const bytes = new TextEncoder().encode(content).length;
  return {
    data: {
      command: "onboarding.intake.schema.export",
      status: "pass",
      path: INTAKE_SCHEMA_EXPORT_PATH,
      bytes,
      dryRun,
      renderedFiles: { [INTAKE_SCHEMA_EXPORT_PATH]: content },
    },
    exitCode: 0,
    summary: dryRun
      ? `onboarding.intake.schema.export: dry-run rendered ${bytes} bytes -> ${INTAKE_SCHEMA_EXPORT_PATH}`
      : `onboarding.intake.schema.export: wrote ${bytes} bytes -> ${INTAKE_SCHEMA_EXPORT_PATH}`,
  };
}
