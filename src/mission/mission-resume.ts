/*
<MODULE_CONTRACT>
  <purpose>RFC-0958: mission.resume — resume the last incomplete lifecycle operation for a mission.</purpose>
  <non-goals>
    <item>Do not implement step logic — steps are defined in mission/steps/ and passed to runOperation.</item>
    <item>Do not manage bordbuch — bordbuch is the business ledger, the journal is technical.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0958: initial mission.resume command handler.</item>
</CHANGE_SUMMARY>
*/

import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
  KernelNextStep,
} from "@warpgogol/werkstatt-engine/kernel";
import { resolveMissionDir } from "./mission-io.ts";
import { readMissionManifest } from "./mission-io.ts";
import {
  acquireLock,
  releaseLock,
  isLockStale,
  removeStaleLock,
  readAllLocks,
} from "../werkstatt/index.ts";
import {
  readJournal,
  findIncompleteOperation,
  abandonOperation,
  runOperation,
} from "../journal/index.ts";
import type { OperationDefinition } from "../journal/index.ts";
import path from "node:path";

export interface MissionResumeData {
  missionId: string;
  resumedOp: string | null;
  opId: string | null;
  skipped: string[];
  executed: string[];
  completed: boolean;
  failedStep?: string;
  abandoned?: boolean;
}

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

function flagBool(input: KernelCommandInput, key: string): boolean {
  const v = input.flags[key];
  return v === true || v === "true";
}

export async function runMissionResume(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<MissionResumeData>> {
  const { workspaceRoot } = context;
  const missionId = flagString(input, "mission");
  if (!missionId) {
    return {
      exitCode: 1,
      summary: "[mission.resume] --mission is required",
      nextSteps: [{ action: "Pass --mission <missionId>", kind: "required" }],
    };
  }

  const missionDir = resolveMissionDir(workspaceRoot, missionId);
  const journalPath = path.join(missionDir, "journal.jsonl");

  const manifest = await readMissionManifest(workspaceRoot, missionId);
  const systemId = manifest.systemId;
  const operationId = manifest.operationId;

  const abandon = flagBool(input, "abandon");
  const force = flagBool(input, "force");

  if (abandon) {
    if (!force) {
      return {
        exitCode: 1,
        summary: "[mission.resume] --abandon requires --force to confirm destructive action",
        nextSteps: [{ action: "Re-run with --abandon --force", kind: "required" }],
      };
    }
    const records = await readJournal(journalPath);
    const incomplete = findIncompleteOperation(records);
    if (!incomplete) {
      return {
        data: {
          missionId,
          resumedOp: null,
          opId: null,
          skipped: [],
          executed: [],
          completed: false,
        },
        exitCode: 0,
        summary: `[mission.resume] nothing to abandon — no incomplete operation for ${missionId}`,
      };
    }
    await abandonOperation(journalPath, incomplete.opId, "manual abandon via --abandon --force");
    return {
      data: {
        missionId,
        resumedOp: incomplete.op,
        opId: incomplete.opId,
        skipped: [],
        executed: [],
        completed: false,
        abandoned: true,
      },
      exitCode: 0,
      summary: `[mission.resume] abandoned ${incomplete.op} (${incomplete.opId}) for ${missionId}`,
    };
  }

  const records = await readJournal(journalPath);
  const incomplete = findIncompleteOperation(records);

  if (!incomplete) {
    return {
      data: { missionId, resumedOp: null, opId: null, skipped: [], executed: [], completed: false },
      exitCode: 0,
      summary: `[mission.resume] nothing to resume for ${missionId}`,
    };
  }

  const def = await resolveOperationDefinition(incomplete.op, workspaceRoot, missionId, manifest);
  if (!def) {
    return {
      exitCode: 1,
      summary: `[mission.resume] unknown operation kind "${incomplete.op}" — cannot resume`,
      nextSteps: [
        { action: `Run mission.resume --mission ${missionId} --abandon --force`, kind: "required" },
      ],
    };
  }

  const systemLockKey = `system:${systemId}`;
  const missionLockKey = `mission:${missionId}`;

  await removeStaleLockIfNeeded(workspaceRoot, systemLockKey);
  await removeStaleLockIfNeeded(workspaceRoot, missionLockKey);

  await acquireLock(workspaceRoot, systemLockKey, operationId, "mission.resume", "agent");
  await acquireLock(workspaceRoot, missionLockKey, operationId, "mission.resume", "agent");

  try {
    const result = await runOperation(
      journalPath,
      def,
      { workspaceRoot, missionId, manifest, context },
      { resumeOpId: incomplete.opId, missionId, platformVersion: "" },
    );

    if (!result.completed) {
      const nextSteps: KernelNextStep[] = [
        {
          action: `Inspect failing step "${result.failedStep}" and fix root cause`,
          kind: "required",
        },
        { action: `Re-run mission.resume --mission ${missionId}`, kind: "required" },
      ];
      return {
        data: {
          missionId,
          resumedOp: incomplete.op,
          opId: result.opId,
          skipped: result.skipped,
          executed: result.executed,
          completed: false,
          failedStep: result.failedStep,
        },
        exitCode: 1,
        summary: `[mission.resume] failed at step "${result.failedStep}" (${result.skipped.length} skipped, ${result.executed.length} executed)`,
        nextSteps,
      };
    }

    return {
      data: {
        missionId,
        resumedOp: incomplete.op,
        opId: result.opId,
        skipped: result.skipped,
        executed: result.executed,
        completed: true,
      },
      exitCode: 0,
      summary: `[mission.resume] completed ${incomplete.op} from step ${result.executed[0] ?? "n/a"} (${result.skipped.length} skipped, ${result.executed.length} executed)`,
    };
  } finally {
    await releaseLock(workspaceRoot, missionLockKey);
    await releaseLock(workspaceRoot, systemLockKey);
  }
}

async function removeStaleLockIfNeeded(workspaceRoot: string, lockKey: string): Promise<void> {
  try {
    const locks = await readAllLocks(workspaceRoot);
    const lock = locks.find((l) => l.scope === lockKey);
    if (lock && isLockStale(lock)) {
      await removeStaleLock(workspaceRoot, lockKey);
    }
  } catch {
    // No lock file exists — nothing to clean up
  }
}

async function resolveOperationDefinition(
  op: string,
  workspaceRoot: string,
  missionId: string,
  manifest: unknown,
): Promise<OperationDefinition<unknown> | null> {
  try {
    const stepsModule = await import("./steps/index.ts");
    if (typeof stepsModule.resolveOperationSteps === "function") {
      const steps = await stepsModule.resolveOperationSteps(op, workspaceRoot, missionId, manifest);
      if (steps) {
        return { op, steps };
      }
    }
  } catch {
    // Steps module not yet available
  }
  return null;
}
