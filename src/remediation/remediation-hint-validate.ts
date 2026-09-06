/*
<MODULE_CONTRACT>
<purpose>
RFC-1027: validates that all validator commands with rules[] declarations have
corresponding entries in REMEDIATION_CATALOG. Emits REMEDIATION-01 for missing
catalog entries and REMEDIATION-02 for catalog entries with no matching validator.
In --mode strict, REMEDIATION-01 is blocking. In --mode warning (default), both
are warnings.
</purpose>
<non-goals>
  <item>Do not validate diagnostic instances — this command validates catalog coverage, not individual diagnostics.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1027: initial implementation.</item>
</CHANGE_SUMMARY>
*/

import { REMEDIATION_CATALOG } from "@warpgogol/werkstatt-shared/share/remediation";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
  Diagnostic,
} from "../kernel/types.ts";
import { diagnosticsResult } from "@warpgogol/werkstatt-shared/checks/result-helpers";

const VALIDATOR_NAME_PATTERN = /\.validate$|\.check$|\.lint$/;

export async function runRemediationHintValidate(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult> {
  const mode = (input.flags["mode"] as string) ?? "warning";
  const strict = mode === "strict";

  const catalogRuleIds = new Set(REMEDIATION_CATALOG.keys());
  const validatorRuleIds = collectValidatorRuleIds(context);

  const diagnostics: Diagnostic[] = [];

  for (const ruleId of validatorRuleIds) {
    if (!catalogRuleIds.has(ruleId)) {
      diagnostics.push({
        ruleId: "REMEDIATION-01",
        severity: strict ? "error" : "warning",
        message: `Validator rule "${ruleId}" has no entry in REMEDIATION_CATALOG — add a remediation pattern for this ruleId.`,
      });
    }
  }

  for (const ruleId of catalogRuleIds) {
    if (!validatorRuleIds.has(ruleId)) {
      diagnostics.push({
        ruleId: "REMEDIATION-02",
        severity: "warning",
        message: `REMEDIATION_CATALOG entry "${ruleId}" has no matching validator rule[] declaration — the catalog entry may be stale.`,
      });
    }
  }

  return diagnosticsResult("remediation.hint.validate", diagnostics);
}

function collectValidatorRuleIds(context: KernelRuntimeContext): Set<string> {
  const ruleIds = new Set<string>();
  for (const cmd of context.actualState.commands.values()) {
    if (cmd.rules && VALIDATOR_NAME_PATTERN.test(cmd.name)) {
      for (const rule of cmd.rules) {
        ruleIds.add(rule);
      }
    }
  }
  return ruleIds;
}
