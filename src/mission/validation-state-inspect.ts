/*
<MODULE_CONTRACT>
<purpose>
RFC-1028: validation.state.inspect command handler — reads the
.validation-state.json file and the persistent SQLite cache to report
per-validator status for a mission.
</purpose>
<non-goals>
  <item>Do not execute validators — this command is read-only.</item>
  <item>Do not modify the cache or validation state.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1028: initial implementation — readValidationState + cache list() for inspection.</item>
</CHANGE_SUMMARY>
*/

import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "../kernel/types.ts";
import {
  readValidationState,
  type ValidationState,
  type ValidatorState,
} from "./validation-state.ts";
import { createCacheLayer, type CacheEntryInfo } from "../kernel/cache/cache-layer.ts";

export interface ValidationStateInspectData {
  missionId: string;
  lastValidatedAt: string | null;
  lastValidationStatus: "pass" | "fail" | "incomplete" | null;
  validatorStates: ValidatorState[];
  cacheEntries: CacheEntryInfo[];
}

export async function runValidationStateInspect(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<ValidationStateInspectData>> {
  const missionId = input.flags.mission as string | undefined;
  if (!missionId) {
    return {
      data: undefined,
      exitCode: 1,
      summary: "[validation.state.inspect] missing required --mission flag",
      nextSteps: [{ action: "Provide --mission <id> flag", kind: "required" }],
    };
  }

  const state = await readValidationState(context.workspaceRoot, missionId);
  const cache = await createCacheLayer(context.workspaceRoot);
  try {
    const cacheEntries = cache.list ? await cache.list({ namespace: "command_results" }) : [];
    const validatorStates = state?.validatorStates ?? [];
    const data: ValidationStateInspectData = {
      missionId,
      lastValidatedAt: state?.lastValidatedAt ?? null,
      lastValidationStatus: state?.lastValidationStatus ?? null,
      validatorStates,
      cacheEntries,
    };
    return {
      data,
      exitCode: 0,
    };
  } finally {
    await cache.close();
  }
}
