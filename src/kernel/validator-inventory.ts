/*
<MODULE_CONTRACT>
<purpose>
RFC-0963: emits docs/validator-inventory.generated.yaml — a mapping of
validation contracts to their validators, rules, pipeline phase, and p95
timing. Enforces fail-closed on missing contract/rules tags. Identifies
consolidation candidates (contracts with more than one validator).
</purpose>
<non-goals>
  <item>Do not import pipeline step arrays from stack plugins — use registry.pipelines instead.</item>
  <item>Do not auto-consolidate validators — only identify candidates.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0963: initial implementation.</item>
</CHANGE_SUMMARY>
*/

import { mkdir, readFile, writeFile as writeFileRaw } from "node:fs/promises";
import { dirname, join } from "node:path";
import { stringify as yamlStringify } from "yaml";
import { buildGeneratedHeader } from "./generated-marker.ts";
import { writeFileAtomic } from "./fs-atomic.ts";
import { loadPipelineBudgets } from "./pipeline-budgets.ts";
import type {
  KernelCommandInput,
  KernelCommandDefinition,
  KernelCommandResult,
  KernelRuntimeContext,
} from "./types.ts";

const INVENTORY_RELATIVE_PATH = join("docs", "validator-inventory.generated.yaml");

const VALIDATOR_NAME_PATTERN = /\.validate$|\.check$|\.lint$/;

export interface ValidatorEntry {
  command: string;
  rules: string[];
  pipelinePhase: string | null;
  p95Ms: number | null;
}

export interface ContractEntry {
  contract: string;
  validators: ValidatorEntry[];
}

export interface ConsolidationCandidate {
  contract: string;
  validatorCount: number;
  validators: string[];
}

export interface ValidatorInventoryFile {
  meta: {
    schemaVersion: 1;
    deterministic: true;
    generatedAt: null;
  };
  contracts: ContractEntry[];
  consolidationCandidates: ConsolidationCandidate[];
  untaggedCommands: string[];
}

export interface ValidatorInventoryGenerateResult {
  command: "validator.inventory.generate";
  written: boolean;
  contractCount: number;
  validatorCount: number;
  consolidationCandidateCount: number;
  untaggedCount: number;
}

function inventoryFilePath(workspaceRoot: string): string {
  return join(workspaceRoot, INVENTORY_RELATIVE_PATH);
}

/**
 * Search registry.pipelines for a command name and return the pipeline name
 * if found. Returns null when the command is not in any registered pipeline.
 */
function derivePipelinePhase(
  registry: KernelRuntimeContext["registry"],
  commandName: string,
): string | null {
  for (const [pipelineName, steps] of registry.pipelines) {
    if (steps.some((step) => step.command === commandName)) {
      return pipelineName;
    }
  }
  return null;
}

/**
 * Look up p95 timing for a validator from the committed budgets file.
 */
async function lookupP95(
  workspaceRoot: string,
  commandName: string,
): Promise<number | null> {
  const budgets = await loadPipelineBudgets(workspaceRoot);
  if (!budgets) return null;
  const entry = budgets.budgets.find((b) => b.command === commandName);
  return entry?.p95Ms ?? null;
}

export async function runValidatorInventoryGenerate(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<ValidatorInventoryGenerateResult>> {
  const dryRun = context.dryRun || input.flags["dry-run"] === true;

  const allCommands = [...context.registry.commands.values()] as KernelCommandDefinition[];
  const validatorCommands = allCommands.filter((cmd) =>
    VALIDATOR_NAME_PATTERN.test(cmd.name),
  );

  // Check for untagged validators
  const untaggedCommands: string[] = [];
  for (const cmd of validatorCommands) {
    if (cmd.contract === undefined || cmd.rules === undefined) {
      untaggedCommands.push(cmd.name);
    }
  }

  // Fail-closed: if any validator lacks contract/rules, return error
  // (unless --dry-run, which emits warnings instead)
  if (untaggedCommands.length > 0 && !dryRun) {
    return {
      data: {
        command: "validator.inventory.generate",
        written: false,
        contractCount: 0,
        validatorCount: validatorCommands.length,
        consolidationCandidateCount: 0,
        untaggedCount: untaggedCommands.length,
      },
      exitCode: 1,
      summary: `[validator.inventory.generate] FAIL-CLOSED: ${untaggedCommands.length} validator(s) missing contract or rules: ${untaggedCommands.slice(0, 10).join(", ")}${untaggedCommands.length > 10 ? ` (and ${untaggedCommands.length - 10} more)` : ""}`,
      nextSteps: [
        {
          action: "Tag all untagged validators with `contract` and `rules` fields, or re-run with --dry-run for a warning-only report",
          kind: "required",
        },
      ],
    };
  }

  // Group validators by contract
  const contractsMap = new Map<string, KernelCommandDefinition[]>();
  for (const cmd of validatorCommands) {
    const contract = cmd.contract ?? "__untagged__";
    const arr = contractsMap.get(contract) ?? [];
    arr.push(cmd);
    contractsMap.set(contract, arr);
  }

  // Build contract entries
  const contracts: ContractEntry[] = [];
  const consolidationCandidates: ConsolidationCandidate[] = [];

  for (const [contract, validators] of contractsMap) {
    const entries: ValidatorEntry[] = [];
    for (const v of validators) {
      const pipelinePhase = derivePipelinePhase(context.registry, v.name);
      const p95Ms = await lookupP95(context.workspaceRoot, v.name);
      entries.push({
        command: v.name,
        rules: v.rules ?? [],
        pipelinePhase,
        p95Ms,
      });
    }
    entries.sort((a, b) => a.command.localeCompare(b.command));
    contracts.push({ contract, validators: entries });

    if (validators.length > 1 && contract !== "__untagged__") {
      consolidationCandidates.push({
        contract,
        validatorCount: validators.length,
        validators: validators.map((v) => v.name).sort(),
      });
    }
  }

  contracts.sort((a, b) => a.contract.localeCompare(b.contract));
  consolidationCandidates.sort((a, b) => a.contract.localeCompare(b.contract));

  const file: ValidatorInventoryFile = {
    meta: {
      schemaVersion: 1,
      deterministic: true,
      generatedAt: null,
    },
    contracts,
    consolidationCandidates,
    untaggedCommands: untaggedCommands.sort(),
  };

  const content = `${buildGeneratedHeader({ filePath: INVENTORY_RELATIVE_PATH, ownerCommand: "validator.inventory.generate" })}${yamlStringify(file)}\n`;

  if (!dryRun) {
    const outputPath = inventoryFilePath(context.workspaceRoot);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFileAtomic(outputPath, content);
  }

  const summaryParts = [
    `[validator.inventory.generate] ${contracts.length} contract(s), ${validatorCommands.length} validator(s)`,
  ];
  if (consolidationCandidates.length > 0) {
    summaryParts.push(`${consolidationCandidates.length} consolidation candidate(s)`);
  }
  if (untaggedCommands.length > 0) {
    summaryParts.push(`${untaggedCommands.length} untagged (warning — dry-run mode)`);
  }

  return {
    data: {
      command: "validator.inventory.generate",
      written: !dryRun,
      contractCount: contracts.length,
      validatorCount: validatorCommands.length,
      consolidationCandidateCount: consolidationCandidates.length,
      untaggedCount: untaggedCommands.length,
    },
    exitCode: 0,
    summary: summaryParts.join(" — "),
  };
}
