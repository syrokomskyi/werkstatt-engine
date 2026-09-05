/*
<MODULE_CONTRACT>
<purpose>
RFC-1028: Validation state types and path resolver for the
.validation-state.json runtime artifact. Records per-validator status
after mission.validate completes, enabling inspection via
validation.state.inspect.
</purpose>
<non-goals>
  <item>Do not implement validation logic — this module only defines types and path resolution.</item>
  <item>Do not read or write the cache — that is handled by the pipeline executor and cache layer.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1028: initial implementation — ValidationState, ValidatorState interfaces, resolveValidationStatePath, readValidationState, writeValidationState.</item>
</CHANGE_SUMMARY>
*/

import { join } from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";

export interface ValidationState {
  missionId: string;
  lastValidatedAt: string;
  lastValidationStatus: "pass" | "fail" | "incomplete";
  validatorStates: ValidatorState[];
}

export interface ValidatorState {
  commandName: string;
  status: "pass" | "fail" | "skipped" | "not-run";
  cached: boolean;
  inputHash?: string;
  moduleHash?: string;
  durationMs?: number;
  skippedBy?: string;
  diagnosticCounts?: { error: number; warning: number; info: number };
}

/**
 * Path: missions/<missionId>/.validation-state.json (gitignored, runtime only).
 */
export function resolveValidationStatePath(workspaceRoot: string, missionId: string): string {
  return join(workspaceRoot, "missions", missionId, ".validation-state.json");
}

export async function readValidationState(
  workspaceRoot: string,
  missionId: string,
): Promise<ValidationState | null> {
  const path = resolveValidationStatePath(workspaceRoot, missionId);
  try {
    const content = await readFile(path, "utf-8");
    return JSON.parse(content) as ValidationState;
  } catch {
    return null;
  }
}

export async function writeValidationState(
  workspaceRoot: string,
  state: ValidationState,
): Promise<void> {
  const path = resolveValidationStatePath(workspaceRoot, state.missionId);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(state, null, 2) + "\n", "utf-8");
}
