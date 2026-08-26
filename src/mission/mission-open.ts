/*
<MODULE_CONTRACT>
<purpose>RFC-0355 §5.1: mission.open — open a new mission for a Sternsystem.</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0355: initial mission.open command handler.</item>
  <item>RFC-0477: commit and push bordbuch after appending mission-open entry.</item>
  <item>RFC-0560: use resolveActor(input) for actor resolution with --actor-from-auth flag.</item>
  <item>RFC-0580: auto-commit werkstatt side-effects (registry.yaml, mission.yaml) after writeRegistry.</item>
  <item>RFC-0593: add bordbuch.validate pre-flight gate before lock acquisition.</item>
  <item>ADR-0030: verify commitAndPushBordbuch succeeded — throw on commit failure (commitSha null) and push failure (pushed false) with distinct error messages.</item>
  <item>Bug fix: auto-repair orphan-mission-close bordbuch violations before lock acquisition; commit and push repaired bordbuch to avoid dirty cache clone blocking mission.reconcile.</item>
  <item>RFC-0796: add cleanupStaleMissionEntries pre-flight cleanup before createMissionDirectories; trash stale symlinks and empty dirs, skip non-empty real dirs with warning.</item>
  <item>Bug fix: clean up mission directories on bordbuch push/commit failure to prevent stale entries on retry.</item>
  <item>Bug fix: list available systems on unknown --system ID for better agent self-correction.</item>
  <item>Bug fix: bordbuch.repair now auto-commits, removed redundant commitAndPushBordbuch call from auto-repair path.</item>
  <item>RFC-0951: auto-materialize workpiece during mission.open with forward-only rollback on failure.</item>
</CHANGE_SUMMARY>
*/

import { existsSync, lstatSync, readdirSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import type { MissionManifest } from "@warpgogol/werkstatt-engine/schemas";
import {
  readSystemConfig,
  readSystemState,
  writeSystemState,
  resolveCacheClonePath,
  discoverSystems,
} from "../sternsystem/registry-io.ts";
import { createMissionDirectories, writeMissionManifest, missionExists } from "./mission-io.ts";
import {
  readBordbuch,
  deriveNextMissionNumberSafe,
  validateBordbuch,
  type BordbuchViolation,
} from "../bordbuch/bordbuch-io.ts";
import { appendAndCommitBordbuch } from "../bordbuch/bordbuch-commit-helper.ts";
import {
  acquireLock,
  releaseLock,
  generateOperationId,
  commitWerkstattSideEffects,
} from "../werkstatt/index.ts";
import { resolveActor } from "./actor-identity.ts";
import { trashPath } from "@warpgogol/forge/utils";
import { gitExec } from "../werkstatt/git-exec.ts";
import { runMissionMaterializeInternal } from "./mission-materialize.ts";

export interface StaleEntryCheck {
  removedPaths: string[];
  skipped: string[];
}

export interface MissionOpenData {
  missionId: string;
  systemId: string;
  state: "open";
  brief: string;
  openedAt: string;
  pinAtOpen: string;
  operationId: string;
  staleEntries: StaleEntryCheck;
  materializedAt: string | null;
}

const REPAIRABLE_RULES = new Set(["orphan-mission-close", "unmatched-mission-open"]);

async function cleanupStaleMissionEntries(
  workspaceRoot: string,
  logger: { info: (msg: string) => void; warn: (msg: string) => void },
): Promise<StaleEntryCheck> {
  const missionsPath = path.join(workspaceRoot, "missions");
  const result: StaleEntryCheck = { removedPaths: [], skipped: [] };

  if (!existsSync(missionsPath)) return result;

  // Scan all entries in missions/ root for stale symlinks and empty dirs
  const entries = readdirSync(missionsPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "archive") continue;
    const entryPath = path.join(missionsPath, entry.name);
    const sourceRel = `missions/${entry.name}`;

    // Use lstatSync to detect symlinks (statSync follows symlinks)
    let stat;
    try {
      stat = lstatSync(entryPath);
    } catch {
      continue;
    }

    if (stat.isSymbolicLink()) {
      await trashPath(entryPath);
      result.removedPaths.push(sourceRel);
      logger.info(`  Cleaned stale symlink: ${sourceRel}`);
    } else if (stat.isDirectory()) {
      // Check if directory is empty
      let isEmpty = true;
      try {
        const dirEntries = readdirSync(entryPath);
        isEmpty = dirEntries.length === 0;
      } catch {
        isEmpty = false;
      }
      if (isEmpty) {
        await trashPath(entryPath);
        result.removedPaths.push(sourceRel);
        logger.info(`  Cleaned empty directory: ${sourceRel}`);
      } else {
        result.skipped.push(sourceRel);
        logger.warn(`  Skipping non-empty real directory: ${sourceRel}`);
      }
    }
  }

  return result;
}
function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

async function preflightBordbuch(
  workspaceRoot: string,
  systemId: string,
): Promise<{ passed: boolean; violations: BordbuchViolation[] }> {
  const { violations } = await validateBordbuch(workspaceRoot, systemId);
  return { passed: violations.length === 0, violations };
}

export async function runMissionOpen(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<MissionOpenData>> {
  const { workspaceRoot, logger } = context;
  const systemId = flagString(input, "system");
  const brief = flagString(input, "brief");
  const actor = resolveActor(input);

  if (!systemId) throw new Error("[mission.open] --system is required");
  if (!brief) throw new Error("[mission.open] --brief is required");

  // Check system exists before proceeding — list available systems on failure
  try {
    await readSystemConfig(workspaceRoot, systemId);
  } catch {
    const { systems: available } = await discoverSystems(workspaceRoot);
    const ids = available.map((s) => s.id).join(", ");
    throw new Error(
      `[mission.open] system '${systemId}' not found. Available systems: ${ids || "(none)"}`,
    );
  }

  // RFC-0593: pre-flight bordbuch validation gate — refuse to open a new mission
  // if the system's bordbuch has any violations. This runs before lock acquisition
  // to avoid holding locks during validation. Known TOCTOU limitation: bordbuch.repair
  // (operator-only) could change the bordbuch concurrently — low risk, failed attempt
  // exits with code 1 before any side effects.
  //
  // Auto-repair: if all violations are orphan-mission-close (safe to repair per
  // RFC-0583), automatically call bordbuch.repair instead of requiring manual
  // intervention. This is the most common violation after a manual bordbuch edit
  // or a crashed mission.close, and repair is deterministic and safe.
  const bordbuchCheck = await preflightBordbuch(workspaceRoot, systemId);
  if (!bordbuchCheck.passed) {
    const allRepairable = bordbuchCheck.violations.every((v) => REPAIRABLE_RULES.has(v.rule));
    if (allRepairable) {
      try {
        const { executeKernelCommand } = await import("@warpgogol/werkstatt-engine/kernel");
        await executeKernelCommand({
          workspaceRoot,
          commandName: "bordbuch.repair",
          argv: [`--system=${systemId}`],
        });
        const recheck = await preflightBordbuch(workspaceRoot, systemId);
        if (!recheck.passed) {
          const violationLines = recheck.violations
            .map((v) => `  ${v.rule}: ${v.message}`)
            .join("\n");
          throw new Error(
            `[mission.open] bordbuch.repair ran but ${recheck.violations.length} violation${recheck.violations.length === 1 ? "" : "s"} remain for system '${systemId}'\n${violationLines}`,
          );
        }
        // bordbuch.repair now auto-commits its output, so no separate
        // commitAndPushBordbuch call is needed here. The cache clone is
        // clean after repair, preventing git pull --rebase failures.
      } catch (repairErr) {
        throw new Error(
          `[mission.open] bordbuch for system '${systemId}' has ${bordbuchCheck.violations.length} repairable violation${bordbuchCheck.violations.length === 1 ? "" : "s"} — auto-repair failed: ${repairErr instanceof Error ? repairErr.message : String(repairErr)}`,
        );
      }
    } else {
      const violationLines = bordbuchCheck.violations
        .map((v) => `  ${v.rule}: ${v.message}`)
        .join("\n");
      throw new Error(
        `[mission.open] bordbuch for system '${systemId}' has ${bordbuchCheck.violations.length} violation${bordbuchCheck.violations.length === 1 ? "" : "s"} — run bordbuch.repair first\n${violationLines}`,
      );
    }
  }

  const operationId = generateOperationId();

  await acquireLock(workspaceRoot, `system:${systemId}`, operationId, "mission.open", actor);

  try {
    const config = await readSystemConfig(workspaceRoot, systemId);
    const state = await readSystemState(workspaceRoot, systemId);

    if (config.status === "paused" || config.status === "archived") {
      throw new Error(
        `[mission.open] system '${systemId}' has status '${config.status}' — cannot open missions`,
      );
    }
    if (state.currentMission) {
      throw new Error(
        `[mission.open] system '${systemId}' already has open mission '${state.currentMission}'`,
      );
    }

    // Check pin file exists
    const cacheDir = resolveCacheClonePath(workspaceRoot, systemId);
    const pinPath = path.join(cacheDir, "system.pin.json");
    if (!existsSync(pinPath)) {
      throw new Error(
        `[mission.open] system '${systemId}' has no system.pin.json — run sternsystem.pin first`,
      );
    }

    // Read pin to get platform version
    const pinRaw = await import("node:fs/promises").then((fs) => fs.readFile(pinPath, "utf8"));
    const pin = JSON.parse(pinRaw);
    const pinAtOpen = pin.platform?.version ?? "unknown";

    // Derive next mission number from Bordbuch + existing directories on disk
    const bordbuchEntries = await readBordbuch(workspaceRoot, systemId);
    const nextNum = await deriveNextMissionNumberSafe(bordbuchEntries, workspaceRoot, systemId);
    const missionId = `${systemId}-m${String(nextNum).padStart(6, "0")}`;

    // Belt-and-suspenders: deriveNextMissionNumberSafe already scans disk
    // directories, but this guard ensures we never overwrite an existing
    // mission manifest even if the directory scan missed it (e.g. race).
    if (await missionExists(workspaceRoot, missionId)) {
      throw new Error(
        `[mission.open] mission directory '${missionId}' already exists — remove it or renumber before opening a new mission`,
      );
    }

    // RFC-0796: Pre-flight cleanup of stale symlinks and empty directories
    // before creating mission directories. Non-empty real directories are
    // skipped with a warning.
    const staleEntries = await cleanupStaleMissionEntries(workspaceRoot, logger);

    // Create mission directories
    await createMissionDirectories(workspaceRoot, missionId);

    // Write mission manifest
    const now = new Date().toISOString();
    const manifest: MissionManifest = {
      schemaVersion: "1.0.0",
      missionId,
      systemId,
      state: "open",
      brief,
      openedAt: now,
      openedBy: actor,
      closedAt: null,
      closedBy: null,
      pinAtOpen,
      materializedAt: null,
      migratedAt: null,
      reconciledAt: null,
      releaseId: null,
      rfcId: null,
      operationId,
    };
    await writeMissionManifest(workspaceRoot, manifest);

    // Append Bordbuch entry and commit+push atomically (RFC-0750, ADR-0030)
    try {
      const { commitResult: pushResult } = await appendAndCommitBordbuch(
        workspaceRoot,
        systemId,
        "mission-open",
        brief,
        actor,
        {
          missionId,
          writerRole: "mission",
          metadata: { brief, pinAtOpen },
        },
        `Bordbuch: mission-open ${missionId}`,
      );
      if (pushResult.commitSha === null) {
        throw new Error(
          `[mission.open] bordbuch commit failed for system '${systemId}' — mission-open event was not committed. ` +
            `Check git state in the cache clone and re-run mission.open.`,
        );
      }
      if (!pushResult.pushed) {
        const cacheDir = resolveCacheClonePath(workspaceRoot, systemId);
        try {
          gitExec(cacheDir, "reset --hard HEAD~1");
        } catch {
          // best-effort rollback — if reset fails, manual intervention needed
        }
        throw new Error(
          `[mission.open] bordbuch push failed for system '${systemId}' — mission-open event was rolled back. ` +
            `Error: ${pushResult.error ?? "unknown"}. ` +
            `Check git remote connectivity and re-run mission.open.`,
        );
      }
    } catch (bordbuchErr) {
      // Clean up mission directories to prevent stale entries on retry
      const missionDir = path.join(workspaceRoot, "missions", missionId);
      try {
        await fs.rm(missionDir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup — if rm fails, manual intervention needed
      }
      throw bordbuchErr;
    }

    // Update state
    state.currentMission = missionId;
    await writeSystemState(workspaceRoot, systemId, state);

    // RFC-0951: Auto-materialize workpiece during mission.open.
    // runMissionMaterializeInternal commits mission.yaml (with materializedAt) and pnpm-lock.yaml.
    // On failure, forward-only rollback appends a compensating bordbuch entry (Step 3).
    let materializedAt: string | null = null;
    try {
      const materializeResult = await runMissionMaterializeInternal(
        workspaceRoot,
        manifest,
        context,
        { reportOnly: false, skipPreflight: false, force: false },
      );
      materializedAt = materializeResult.data?.materializedAt ?? null;
    } catch (materializeErr) {
      // Forward-only rollback — RFC-0951, DNA-46 append-only log.
      // Append compensating bordbuch entry, remove mission dir, clear state.
      try {
        await appendAndCommitBordbuch(
          workspaceRoot,
          systemId,
          "mission-open-rolled-back",
          `Materialization failed: ${materializeErr instanceof Error ? materializeErr.message : String(materializeErr)}`,
          actor,
          {
            missionId,
            writerRole: "mission",
            metadata: {
              reason:
                materializeErr instanceof Error ? materializeErr.message : String(materializeErr),
            },
          },
          `Bordbuch: mission-open-rolled-back ${missionId}`,
        );
      } catch (bordbuchRollbackErr) {
        logger.warn(
          `[mission.open] compensating bordbuch entry failed: ${bordbuchRollbackErr instanceof Error ? bordbuchRollbackErr.message : String(bordbuchRollbackErr)}. ` +
            `Run bordbuch.repair to fix the bordbuch manually.`,
        );
      }
      // Remove mission directory
      const missionDir = path.join(workspaceRoot, "missions", missionId);
      try {
        await fs.rm(missionDir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
      // Clear state
      state.currentMission = null;
      await writeSystemState(workspaceRoot, systemId, state);
      // Commit cleared state (mission.yaml no longer exists)
      await commitWerkstattSideEffects(
        workspaceRoot,
        [path.join("..", "systems-cache", systemId, "system-state.yaml")],
        `werkstatt: mission.open rollback ${missionId}`,
      );
      throw new Error(
        `[mission.open] materialization failed — mission rolled back: ${materializeErr instanceof Error ? materializeErr.message : String(materializeErr)}`,
      );
    }

    // RFC-0580: auto-commit werkstatt side-effects (system-state.yaml only;
    // mission.yaml + pnpm-lock.yaml already committed by runMissionMaterializeInternal)
    await commitWerkstattSideEffects(
      workspaceRoot,
      [path.join("..", "systems-cache", systemId, "system-state.yaml")],
      `werkstatt: mission.open ${missionId}`,
    );

    return {
      data: {
        missionId,
        systemId,
        state: "open",
        brief,
        openedAt: now,
        pinAtOpen,
        operationId,
        staleEntries,
        materializedAt,
      },
      summary: `[mission.open] opened and materialized mission ${missionId} for ${systemId}`,
      nextSteps: [
        {
          action: `Validate the workpiece: pnpm exec werkstatt run mission.validate --mission ${missionId}`,
          kind: "optional",
        },
      ],
    };
  } finally {
    await releaseLock(workspaceRoot, `system:${systemId}`);
  }
}
