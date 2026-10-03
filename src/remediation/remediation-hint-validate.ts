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
  <item>ADR-0105 fo-review: resolve the full workspace registry via
        getOrBuildWorkspaceRegistry — a single-module actualState on the fast path
        produced phantom REMEDIATION-02 for every catalog entry owned by another
        module (the same blind-spot class as the commands-validate detector gap).</item>
</CHANGE_SUMMARY>
*/

import { REMEDIATION_CATALOG } from "@warpgogol/werkstatt-shared/remediation";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
  Diagnostic,
} from "@warpgogol/werkstatt-shared/kernel";
import { diagnosticsResult } from "@warpgogol/werkstatt-shared/checks/result-helpers";
import { getOrBuildWorkspaceRegistry } from "../kernel/runtime/registry-cache.ts";
import type { ActualState } from "@warpgogol/werkstatt-shared/kernel";

const VALIDATOR_NAME_PATTERN = /\.validate$|\.check$|\.lint$/;

export async function runRemediationHintValidate(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult> {
  const mode = (input.flags["mode"] as string) ?? "warning";
  const strict = mode === "strict";

  // The fast-path may hand this command a single-module actualState (only the
  // remediation module's commands) — the check needs the FULL workspace
  // registry, same as validator.inventory.generate (validator-inventory.ts).
  const registry =
    (await getOrBuildWorkspaceRegistry(context.workspaceRoot)) ?? context.actualState;

  const catalogRuleIds = new Set(REMEDIATION_CATALOG.keys());
  const validatorRuleIds = collectValidatorRuleIds(registry);

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

function collectValidatorRuleIds(registry: ActualState): Set<string> {
  const ruleIds = new Set<string>();
  for (const cmd of registry.commands.values()) {
    if (cmd.rules && VALIDATOR_NAME_PATTERN.test(cmd.name)) {
      for (const rule of cmd.rules) {
        ruleIds.add(rule);
      }
    }
  }
  return ruleIds;
}
