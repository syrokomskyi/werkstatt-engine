/*
<MODULE_CONTRACT>
<purpose>RFC-0355 §5.4: mission.abort — abort an open mission and preserve Werkstück/Distribution for preview.</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0355: initial mission.abort command handler.</item>
  <item>RFC-0477: commit and push bordbuch after appending mission-abort entry.</item>
  <item>RFC-0480: preserve workpiece/distribution; create git bundle in evidence/ before aborting.</item>
  <item>RFC-0480: add non-blocking dirty workpiece warning to mission.abort.</item>
  <item>Block mission.abort on dirty workpiece and unreconciled operator commits to prevent silent loss of changes.</item>
  <item>RFC-0560: use resolveActor(input) for actor resolution with --actor-from-auth flag.</item>
  <item>RFC-0580: auto-commit werkstatt side-effects (registry.yaml, mission.yaml) after writeRegistry.</item>
  <item>RFC-0958: wrap post-lock lifecycle in runOperation with journal for crash-safe resume.</item>
</CHANGE_SUMMARY>
*/

import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { readSystemState, writeSystemState } from "../sternsystem/registry-io.ts";
import { readMissionManifest, writeMissionManifest, resolveMissionDir } from "./mission-io.ts";
import { isWorkpieceDirty, countOperatorCommits } from "./mission-git-commit.ts";
import { appendAndCommitBordbuch } from "../bordbuch/bordbuch-commit-helper.ts";
import { acquireLock, releaseLock, commitWerkstattSideEffects } from "../werkstatt/index.ts";
import { resolveActor } from "./actor-identity.ts";
import { runOperation } from "../journal/runner.ts";
import { checkDifferentKindOperation } from "../journal/index.ts";
import type { OperationStep, OperationDefinition } from "../journal/index.ts";
import type { MissionManifest } from "@warpgogol/werkstatt-engine/schemas";

export interface MissionAbortData {
  missionId: string;
  systemId: string;
  state: "aborted";
  closedAt: string;
  reason: string;
}

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

export async function runMissionAbort(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<MissionAbortData>> {
  const { workspaceRoot } = context;
  const missionId = flagString(input, "mission");
  const reason = flagString(input, "reason");
  const actor = resolveActor(input);

  if (!missionId) throw new Error("[mission.abort] --mission is required");
  if (!reason) throw new Error("[mission.abort] --reason is required");

  const manifest = await readMissionManifest(workspaceRoot, missionId);

  if (manifest.state !== "open") {
    throw new Error(
      `[mission.abort] mission '${missionId}' is not open (state: ${manifest.state})`,
    );
  }

  await acquireLock(
    workspaceRoot,
    `system:${manifest.systemId}`,
    manifest.operationId,
    "mission.abort",
    actor,
  );
  await acquireLock(
    workspaceRoot,
    `mission:${missionId}`,
    manifest.operationId,
    "mission.abort",
    actor,
  );

  try {
    const missionDir = resolveMissionDir(workspaceRoot, missionId);
    const workpieceDir = path.join(missionDir, "workpiece");
    const evidenceDir = path.join(missionDir, "evidence");
    await fs.mkdir(evidenceDir, { recursive: true });

    const now = new Date().toISOString();

    const abortCtx: AbortStepCtx = {
      workspaceRoot,
      missionId,
      missionDir,
      workpieceDir,
      evidenceDir,
      manifest,
      actor,
      reason,
      now,
    };

    const steps = await buildAbortSteps(workspaceRoot, missionId, abortCtx);
    const journalPath = path.join(missionDir, "journal.jsonl");

    // RFC-0958 Step 7: block if a different-kind operation is incomplete
    const blockCheck = await checkDifferentKindOperation(journalPath, "mission.abort");
    if (blockCheck.blocked) {
      return {
        data: {
          missionId,
          systemId: manifest.systemId,
          state: "aborted" as const,
          abortedAt: new Date().toISOString(),
          blockedByOperation: blockCheck.incompleteOp,
        } as unknown as MissionAbortData,
        exitCode: 1,
        summary: `[mission.abort] ${missionId} blocked: incomplete '${blockCheck.incompleteOp}' operation found in journal`,
        nextSteps: [
          {
            action: `Run: pnpm exec werkstatt run mission.resume --mission ${missionId} to resume or abandon the incomplete operation`,
            kind: "required",
          },
        ],
      };
    }

    const def: OperationDefinition<unknown> = { op: "mission.abort", steps };
    const opResult = await runOperation(journalPath, def, abortCtx, {
      missionId,
      platformVersion: "",
    });

    if (!opResult.completed) {
      const detail = opResult.failedStepError ?? "unknown error";
      throw new Error(
        `[mission.abort] step "${opResult.failedStep}" failed: ${detail} — run mission.resume --mission ${missionId} to retry`,
      );
    }

    return {
      data: {
        missionId,
        systemId: manifest.systemId,
        state: "aborted",
        closedAt: now,
        reason,
      },
      summary: `[mission.abort] aborted mission ${missionId}`,
      nextSteps: [
        {
          action: `Open a new mission: pnpm exec werkstatt run mission.open --system ${manifest.systemId} --brief "<new brief>"`,
          kind: "optional",
        },
      ],
    };
  } finally {
    await releaseLock(workspaceRoot, `mission:${missionId}`);
    await releaseLock(workspaceRoot, `system:${manifest.systemId}`);
  }
}

// ---------------------------------------------------------------------------
// RFC-0958: Journal-integrated abort steps
// ---------------------------------------------------------------------------

export interface AbortStepCtx {
  workspaceRoot: string;
  missionId: string;
  missionDir: string;
  workpieceDir: string;
  evidenceDir: string;
  manifest: MissionManifest;
  actor: ReturnType<typeof resolveActor>;
  reason: string;
  now: string;
}

export async function buildAbortSteps(
  _workspaceRoot: string,
  _missionId: string,
  ctx: unknown,
): Promise<OperationStep<unknown>[]> {
  const _ctx = ctx as AbortStepCtx;
  const steps: OperationStep<unknown>[] = [
    {
      name: "dirty-workpiece-check",
      run: async (c: unknown) => {
        const cc = c as AbortStepCtx;
        const dirtyCheck = isWorkpieceDirty(cc.workpieceDir);
        if (dirtyCheck.dirty) {
          throw new Error(
            `[mission.abort] workpiece has ${dirtyCheck.fileCount} uncommitted file(s). Run \`pnpm exec werkstatt run mission.git.commit --mission ${cc.missionId} --message "<msg>"\` first, then re-run abort.`,
          );
        }
      },
    },
    {
      name: "unreconciled-commits-check",
      run: async (c: unknown) => {
        const cc = c as AbortStepCtx;
        const operatorCommits = countOperatorCommits(cc.workpieceDir, cc.manifest.migratedAt);
        if (operatorCommits.hasOperatorCommits && !cc.manifest.reconciledAt) {
          throw new Error(
            `[mission.abort] workpiece has ${operatorCommits.commitCount} unreconciled operator commit(s). These changes will be LOST on abort. Either:\n  1. Run \`pnpm exec werkstatt run mission.reconcile --mission ${cc.missionId}\` then \`mission.close\` to preserve changes, OR\n  2. Manually revert the operator commits if the changes are not needed:\n${operatorCommits.commits.map((c2) => `     ${c2}`).join("\n")}`,
          );
        }
      },
    },
    {
      name: "create-git-bundle",
      run: async (c: unknown) => {
        const cc = c as AbortStepCtx;
        if (existsSync(path.join(cc.workpieceDir, ".git"))) {
          const bundlePath = path.join(cc.evidenceDir, "workpiece.git-bundle");
          try {
            execSync(`git bundle create ${JSON.stringify(bundlePath)} --all`, {
              cwd: cc.workpieceDir,
              stdio: ["pipe", "pipe", "pipe"],
            });
          } catch {
            // Bundle creation failed — non-fatal
          }
        }
      },
    },
    {
      name: "transition-state",
      run: async (c: unknown) => {
        const cc = c as AbortStepCtx;
        cc.manifest.state = "aborted";
        cc.manifest.closedAt = cc.now;
        cc.manifest.closedBy = cc.actor;
        await writeMissionManifest(cc.workspaceRoot, cc.manifest);
      },
      verify: async (c: unknown) => {
        const cc = c as AbortStepCtx;
        const reRead = await readMissionManifest(cc.workspaceRoot, cc.missionId);
        return reRead.state === "aborted";
      },
    },
    {
      name: "bordbuch-append",
      run: async (c: unknown) => {
        const cc = c as AbortStepCtx;
        await appendAndCommitBordbuch(
          cc.workspaceRoot,
          cc.manifest.systemId,
          "mission-abort",
          `Mission ${cc.missionId} aborted: ${cc.reason}`,
          cc.actor,
          {
            missionId: cc.missionId,
            writerRole: "mission",
            metadata: { reason: cc.reason },
          },
          `Bordbuch: mission-abort ${cc.missionId}`,
        );
      },
    },
    {
      name: "update-system-state",
      run: async (c: unknown) => {
        const cc = c as AbortStepCtx;
        const state = await readSystemState(cc.workspaceRoot, cc.manifest.systemId);
        if (state.currentMission === cc.missionId) {
          state.currentMission = null;
          await writeSystemState(cc.workspaceRoot, cc.manifest.systemId, state);
        }
      },
    },
    {
      name: "commit-werkstatt-side-effects",
      run: async (c: unknown) => {
        const cc = c as AbortStepCtx;
        await commitWerkstattSideEffects(
          cc.workspaceRoot,
          [path.join("missions", cc.missionId, "mission.yaml")],
          `werkstatt: mission.abort ${cc.missionId}`,
        );
      },
    },
  ];

  return steps;
}
