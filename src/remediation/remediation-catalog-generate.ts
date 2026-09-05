/*
<MODULE_CONTRACT>
<purpose>
RFC-1027: emits docs/remediation-catalog.generated.yaml from REMEDIATION_CATALOG,
cross-referencing validator rules[] declarations to identify uncovered ruleIds.
</purpose>
<non-goals>
  <item>Do not own the catalog — that lives in @warpgogol/werkstatt-shared/share/remediation.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1027: initial implementation.</item>
</CHANGE_SUMMARY>
*/

import { writeFile as writeFileRaw, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { stringify as yamlStringify } from "yaml";
import { buildGeneratedHeader } from "../kernel/generated-marker.ts";
import { writeFileAtomic } from "../kernel/fs-atomic.ts";
import { REMEDIATION_CATALOG } from "@warpgogol/werkstatt-shared/share/remediation";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "../kernel/types.ts";

const CATALOG_RELATIVE_PATH = join("docs", "remediation-catalog.generated.yaml");

export interface RemediationCatalogEntry {
  ruleId: string;
  action: string;
  template?: string;
  docRef?: string;
  targetFiles?: string[];
}

export interface RemediationCatalogFile {
  meta: {
    schemaVersion: 1;
    deterministic: true;
    generatedAt: null;
  };
  entries: RemediationCatalogEntry[];
  uncoveredRuleIds: string[];
}

export interface RemediationCatalogGenerateResult {
  command: "remediation.catalog.generate";
  written: boolean;
  entryCount: number;
  uncoveredCount: number;
}

export async function runRemediationCatalogGenerate(
  _input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<RemediationCatalogGenerateResult>> {
  const workspaceRoot = context.workspaceRoot;
  const catalogPath = join(workspaceRoot, CATALOG_RELATIVE_PATH);

  const entries: RemediationCatalogEntry[] = [...REMEDIATION_CATALOG.values()].map((p) => {
    const entry: RemediationCatalogEntry = { ruleId: p.ruleId, action: p.action };
    if (p.template !== undefined) entry.template = p.template;
    if (p.docRef !== undefined) entry.docRef = p.docRef;
    if (p.targetFiles !== undefined) entry.targetFiles = p.targetFiles;
    return entry;
  });

  const catalogRuleIds = new Set(REMEDIATION_CATALOG.keys());
  const validatorRuleIds = collectValidatorRuleIds(context);
  const uncoveredRuleIds = validatorRuleIds.filter((id) => !catalogRuleIds.has(id));

  const file: RemediationCatalogFile = {
    meta: {
      schemaVersion: 1,
      deterministic: true,
      generatedAt: null,
    },
    entries,
    uncoveredRuleIds,
  };

  const header = buildGeneratedHeader({
    filePath: catalogPath,
    ownerCommand: "remediation.catalog.generate",
  });
  const yaml = yamlStringify(file, { sortMapEntries: false });
  await mkdir(dirname(catalogPath), { recursive: true });
  await writeFileAtomic(catalogPath, `${header}\n${yaml}`);

  return {
    data: {
      command: "remediation.catalog.generate",
      written: true,
      entryCount: entries.length,
      uncoveredCount: uncoveredRuleIds.length,
    },
    exitCode: 0,
    summary: `[remediation.catalog.generate] ${entries.length} entries, ${uncoveredRuleIds.length} uncovered ruleIds`,
  };
}

function collectValidatorRuleIds(context: KernelRuntimeContext): string[] {
  const ruleIds = new Set<string>();
  for (const cmd of context.registry.commands.values()) {
    if (cmd.rules) {
      for (const rule of cmd.rules) {
        ruleIds.add(rule);
      }
    }
  }
  return [...ruleIds].sort();
}
