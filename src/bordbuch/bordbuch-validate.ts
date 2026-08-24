/*
<MODULE_CONTRACT>
<purpose>RFC-0355 §5.7: bordbuch.validate — validate the Bordbuch hash-chain and lifecycle pairs.</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0355: initial bordbuch.validate command handler.</item>
</CHANGE_SUMMARY>
*/

import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { validateBordbuch, type BordbuchViolation } from "./bordbuch-io.ts";

export interface BordbuchValidateData {
  systemId: string;
  events: number;
  violations: BordbuchViolation[];
}

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

export async function runBordbuchValidate(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<BordbuchValidateData>> {
  const { workspaceRoot, logger } = context;
  const systemId = flagString(input, "system") ?? context.site?.name;

  if (!systemId) throw new Error("[bordbuch.validate] --system is required");

  const { entries, violations } = await validateBordbuch(workspaceRoot, systemId);

  for (const v of violations) {
    logger.error(`  [${v.rule}] ${v.message}`);
  }

  return {
    data: { systemId, events: entries, violations },
    exitCode: violations.length > 0 ? 1 : 0,
    summary:
      violations.length > 0
        ? undefined
        : `[bordbuch.validate] ${systemId}: ${entries} entries, 0 violations`,
  };
}
