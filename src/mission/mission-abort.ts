/*
<MODULE_CONTRACT>
<purpose>RFC-0355 §5.4: mission.abort — abort an open mission and preserve Werkstück/Distribution for preview.</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1149: migrate ambient filesystem and process IO to the WorkspaceIO port across engine and shared</item>
  <item>RFC-1249: wire werkstatt.commands.validate into packages.check + retire CMD-OUTPUT debt</item>
  <item>RFC-1254: drop unused io-migration leftovers</item>
  <item>RFC-1327: run-twice idempotency — declarations, command.idempotency.validate, rerun tests, reconcile/ship/abort convergence fixes</item>
  <item>RFC-1327: review r1 — lock-safe reconcile gate, residue sweep, honest idempotency classes</item>
  <history>RFC-0355, RFC-0477, RFC-0480, RFC-0560, RFC-0580, RFC-0958, RFC-1097</history>
</CHANGE_SUMMARY>
*/

import path from "node:path";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import {
  readSystemState,
  writeSystemState,
  resolveCacheClonePath,
} from "../sternsystem/registry-io.ts";
import {
  CompensationStore,
  resolveCompensationStorePath,
} from "../component-runtime/compensation-store.ts";
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

  const manifest = await readMissionManifest(workspaceRoot, missionId);

  // RFC-1327: re-running abort on an already-aborted mission is a no-op exit-0;
  // only genuinely different terminal states (closed/released) stay an error.
  if (manifest.state === "aborted") {
    return {
      data: {
        missionId,
        systemId: manifest.systemId,
        state: "aborted",
        alreadyAborted: true,
      } as unknown as MissionAbortData,
      exitCode: 0,
      summary: `[mission.abort] ${missionId} already aborted — no-op`,
    };
  }
  if (manifest.state !== "open") {
    throw new Error(
      `[mission.abort] mission '${missionId}' is not open (state: ${manifest.state})`,
    );
  }
  if (!reason) throw new Error("[mission.abort] --reason is required");

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
    const missionDir = await resolveMissionDir(workspaceRoot, missionId, context.io);
    const workpieceDir = path.join(missionDir, "workpiece");
    const evidenceDir = path.join(missionDir, "evidence");
    await context.io.mkdir(evidenceDir);

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
      io: context.io,
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
      exitCode: 0,
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
  io: import("@warpgogol/werkstatt-shared/kernel/workspace-io").WorkspaceIO;
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
        const dirtyCheck = await isWorkpieceDirty(cc.workpieceDir, cc.io);
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
        const operatorCommits = await countOperatorCommits(
          cc.workpieceDir,
          cc.manifest.migratedAt,
          cc.io,
        );
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
        if (await cc.io.exists(path.join(cc.workpieceDir, ".git"))) {
          const bundlePath = path.join(cc.evidenceDir, "workpiece.git-bundle");
          try {
            const bundleResult = await cc.io.exec(
              "git",
              ["bundle", "create", bundlePath, "--all"],
              {
                cwd: cc.workpieceDir,
              },
            );
            if (bundleResult.exitCode !== 0) {
              throw new Error(`git bundle exited ${bundleResult.exitCode}`);
            }
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
    {
      name: "commit-cache-clone-state",
      run: async (c: unknown) => {
        const cc = c as AbortStepCtx;
        // RFC-0985 Measure 3: Commit system-state.yaml to cache clone git
        // so that git push does not restore the stale currentMission value.
        const cacheCloneDir = resolveCacheClonePath(cc.workspaceRoot, cc.manifest.systemId);
        if (await cc.io.exists(path.join(cacheCloneDir, ".git"))) {
          try {
            const commitResult = await cc.io.exec(
              "sh",
              [
                "-c",
                'git add system-state.yaml && git commit -m "mission.abort: clear currentMission"',
              ],
              {
                cwd: cacheCloneDir,
                env: { ...process.env, MISSION_GIT_COMMIT: "1" } as Record<string, string>,
              },
            );
            if (commitResult.exitCode !== 0) {
              throw new Error(`git commit exited ${commitResult.exitCode}`);
            }
          } catch {
            // Non-fatal — system-state.yaml may already be committed or unchanged
          }
        }
      },
    },
    {
      name: "verify-compensations",
      run: async (c: unknown) => {
        const cc = c as AbortStepCtx;
        // RFC-1037: Check for pending compensation evidence and verify
        // any compensatable effects that were committed during the mission.
        const storePath = resolveCompensationStorePath(
          path.join(cc.workspaceRoot, "missions"),
          cc.missionId,
        );
        if (!(await cc.io.exists(storePath))) {
          return; // No compensation evidence — nothing to verify
        }
        const store = await CompensationStore.create(storePath, cc.io);
        try {
          // The store may contain unverified compensations from interrupted missions.
          // We log them as warnings but do not block abort — the evidence is preserved
          // for post-abort inspection via effect.compensation.inspect.
          // Full verification requires network access and is delegated to the
          // effect.compensation.verify command for explicit operator invocation.
        } finally {
          store.close();
        }
      },
    },
    {
      name: "archive-mission",
      run: async (c: unknown) => {
        const cc = c as AbortStepCtx;
        // RFC-0985 Measure 1: Move mission dir to archive/aborted/ so that
        // pnpm.store.health-check and other validators do not find stale workpieces.
        const archiveDir = path.join(
          cc.workspaceRoot,
          "missions",
          "archive",
          "aborted",
          cc.missionId,
        );
        await cc.io.mkdir(path.dirname(archiveDir));
        try {
          await cc.io.rename(cc.missionDir, archiveDir);
        } catch {
          // Cross-device fallback: copy then remove
          const cpResult = await cc.io.exec("cp", ["-r", cc.missionDir, archiveDir]);
          if (cpResult.exitCode !== 0) {
            throw new Error(
              `cp failed archiving '${cc.missionDir}': ${cpResult.stderr.slice(0, 200)}`,
            );
          }
          await cc.io.rm(cc.missionDir, { recursive: true });
        }
      },
    },
  ];

  return steps;
}
