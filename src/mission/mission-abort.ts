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
    // RFC-0480: create git bundle from workpiece as audit artifact, then preserve workpiece
    const missionDir = resolveMissionDir(workspaceRoot, missionId);
    const workpieceDir = path.join(missionDir, "workpiece");
    const evidenceDir = path.join(missionDir, "evidence");
    await fs.mkdir(evidenceDir, { recursive: true });

    const dirtyCheck = isWorkpieceDirty(workpieceDir);
    if (dirtyCheck.dirty) {
      throw new Error(
        `[mission.abort] workpiece has ${dirtyCheck.fileCount} uncommitted file(s). Run \`pnpm exec werkstatt run mission.git.commit --mission ${missionId} --message "<msg>"\` first, then re-run abort.`,
      );
    }

    const operatorCommits = countOperatorCommits(workpieceDir, manifest.migratedAt);
    if (operatorCommits.hasOperatorCommits && !manifest.reconciledAt) {
      throw new Error(
        `[mission.abort] workpiece has ${operatorCommits.commitCount} unreconciled operator commit(s). These changes will be LOST on abort. Either:\n  1. Run \`pnpm exec werkstatt run mission.reconcile --mission ${missionId}\` then \`mission.close\` to preserve changes, OR\n  2. Manually revert the operator commits if the changes are not needed:\n${operatorCommits.commits.map((c) => `     ${c}`).join("\n")}`,
      );
    }

    if (existsSync(path.join(workpieceDir, ".git"))) {
      const bundlePath = path.join(evidenceDir, "workpiece.git-bundle");
      try {
        execSync(`git bundle create ${JSON.stringify(bundlePath)} --all`, {
          cwd: workpieceDir,
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch {
        // Bundle creation failed — non-fatal, abort proceeds
      }
    }
    // Workpiece and distribution are preserved on disk for mission.preview (RFC-0480)

    const now = new Date().toISOString();
    manifest.state = "aborted";
    manifest.closedAt = now;
    manifest.closedBy = actor;

    await writeMissionManifest(workspaceRoot, manifest);

    await appendAndCommitBordbuch(
      workspaceRoot,
      manifest.systemId,
      "mission-abort",
      `Mission ${missionId} aborted: ${reason}`,
      actor,
      {
        missionId,
        writerRole: "mission",
        metadata: { reason },
      },
      `Bordbuch: mission-abort ${missionId}`,
    );

    const state = await readSystemState(workspaceRoot, manifest.systemId);
    if (state.currentMission === missionId) {
      state.currentMission = null;
      await writeSystemState(workspaceRoot, manifest.systemId, state);
    }

    // RFC-0580: auto-commit werkstatt side-effects
    await commitWerkstattSideEffects(
      workspaceRoot,
      [path.join("missions", missionId, "mission.yaml")],
      `werkstatt: mission.abort ${missionId}`,
    );

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
