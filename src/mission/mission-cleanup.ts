/*
<MODULE_CONTRACT>
<purpose>RFC-0480: mission.cleanup — explicit workpiece cleanup with age-based option. RFC-0652: age-based Axiom evidence cleanup. RFC-0985: --stale-dirs mode to archive aborted missions and remove stub directories.</purpose>
<non-goals>
  <item>Does not remove non-Axiom evidence bundles (close-report.json, workpiece.git-bundle) — those are permanent audit artifacts.</item>
  <item>Does not abort missions — use mission.abort for that.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0480: initial mission.cleanup command handler.</item>
  <item>RFC-0652: replace unconditional evidence preservation with age-based Axiom evidence cleanup; add --evidence-retention-days flag.</item>
  <item>RFC-0985: add --stale-dirs mode to archive aborted missions and remove stub directories.</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { readMissionManifest, resolveMissionDir } from "./mission-io.ts";

export interface MissionCleanupData {
  missionId: string;
  removedPaths: string[];
  skipped: string[];
  evidenceCleaned: boolean;
  evidenceRetentionDays: number;
  archived?: string[];
  warnings?: string[];
}

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

function flagNumber(input: KernelCommandInput, key: string, defaultValue: number): number {
  const v = input.flags[key];
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = parseInt(v, 10);
    if (!Number.isNaN(n) && n >= 0) return n;
  }
  return defaultValue;
}

function flagBoolean(input: KernelCommandInput, key: string): boolean {
  const v = input.flags[key];
  return v === true || v === "true";
}

function parseOlderThan(value: string): number | null {
  const match = value.match(/^(\d+)d$/);
  if (!match) return null;
  return parseInt(match[1], 10) * 24 * 60 * 60 * 1000;
}

export async function runMissionCleanup(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<MissionCleanupData>> {
  const { workspaceRoot, logger } = context;
  const missionId = flagString(input, "mission");
  const olderThan = flagString(input, "older-than");
  const staleDirs = flagBoolean(input, "stale-dirs");
  const evidenceRetentionDays = flagNumber(input, "evidence-retention-days", 30);

  if (!missionId && !olderThan && !staleDirs) {
    throw new Error(
      "[mission.cleanup] either --mission, --older-than, or --stale-dirs is required",
    );
  }

  const removedPaths: string[] = [];
  const skipped: string[] = [];
  let evidenceCleaned = false;

  // --stale-dirs mode: RFC-0985 Measure 6 — archive aborted missions, remove stub dirs
  if (staleDirs) {
    const missionsDir = path.join(workspaceRoot, "missions");
    if (!existsSync(missionsDir)) {
      return {
        data: {
          missionId: "*",
          removedPaths,
          skipped,
          evidenceCleaned,
          evidenceRetentionDays,
          archived: [],
          warnings: [],
        },
        summary: `[mission.cleanup] no missions directory found`,
        nextSteps: [],
      };
    }

    const archived: string[] = [];
    const warnings: string[] = [];
    const entries = await fs.readdir(missionsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name === "archive") continue;
      if (entry.isSymbolicLink()) continue;
      if (!entry.isDirectory()) continue;

      const missionDir = path.join(missionsDir, entry.name);
      const missionFile = path.join(missionDir, "mission.yaml");

      if (!existsSync(missionFile)) {
        // Stub directory from failed mission.open — remove it
        await fs.rm(missionDir, { recursive: true, force: true });
        removedPaths.push(`${entry.name} (stub — no mission.yaml)`);
        logger.info(`  Removed stub directory '${entry.name}'`);
        continue;
      }

      try {
        const manifest = await readMissionManifest(workspaceRoot, entry.name);
        if (manifest.state === "aborted") {
          // Move to archive/aborted/
          const archiveDir = path.join(missionsDir, "archive", "aborted", entry.name);
          await fs.mkdir(path.dirname(archiveDir), { recursive: true });
          try {
            await fs.rename(missionDir, archiveDir);
          } catch {
            await fs.cp(missionDir, archiveDir, { recursive: true, force: true });
            await fs.rm(missionDir, { recursive: true, force: true });
          }
          archived.push(entry.name);
          logger.info(`  Archived aborted mission '${entry.name}'`);
        } else if (manifest.state === "open") {
          warnings.push(`${entry.name} is open — skipped`);
        }
      } catch {
        warnings.push(`${entry.name} — failed to read mission.yaml`);
      }
    }

    return {
      data: {
        missionId: "*",
        removedPaths,
        skipped,
        evidenceCleaned,
        evidenceRetentionDays,
        archived,
        warnings,
      },
      summary: `[mission.cleanup] stale-dirs: archived ${archived.length}, removed ${removedPaths.length}, warnings ${warnings.length}`,
      nextSteps: [],
    };
  }

  if (missionId) {
    const manifest = await readMissionManifest(workspaceRoot, missionId);

    if (manifest.state === "open") {
      throw new Error(`[mission.cleanup] mission '${missionId}' is open — abort or close it first`);
    }

    const missionDir = resolveMissionDir(workspaceRoot, missionId);
    const workpieceDir = path.join(missionDir, "workpiece");
    const distributionDir = path.join(missionDir, "distribution");

    if (existsSync(workpieceDir)) {
      await fs.rm(workpieceDir, { recursive: true, force: true });
      removedPaths.push("workpiece");
      logger.info(`  Removed workpiece for mission '${missionId}'`);
    }

    if (existsSync(distributionDir)) {
      await fs.rm(distributionDir, { recursive: true, force: true });
      removedPaths.push("distribution");
      logger.info(`  Removed distribution for mission '${missionId}'`);
    }

    // RFC-0652: Age-based Axiom evidence cleanup.
    // Non-Axiom evidence (close-report.json, workpiece.git-bundle) is always preserved.
    // Only evidence/axiom/ is eligible for cleanup, and only if evidence-metadata.json
    // exists with a runTimestamp older than the retention period.
    const axiomEvidenceDir = path.join(missionDir, "evidence", "axiom");
    if (evidenceRetentionDays === 0) {
      skipped.push("evidence/axiom (preserved — retention=0)");
    } else if (existsSync(axiomEvidenceDir)) {
      const metadataPath = path.join(axiomEvidenceDir, "evidence-metadata.json");
      if (!existsSync(metadataPath)) {
        skipped.push("evidence/axiom (no metadata — preserved)");
      } else {
        try {
          const raw = await fs.readFile(metadataPath, "utf8");
          const meta = JSON.parse(raw) as { runTimestamp?: string };
          if (!meta.runTimestamp) {
            skipped.push("evidence/axiom (no runTimestamp — preserved)");
          } else {
            const runTime = new Date(meta.runTimestamp).getTime();
            const cutoff = Date.now() - evidenceRetentionDays * 24 * 60 * 60 * 1000;
            if (runTime < cutoff) {
              await fs.rm(axiomEvidenceDir, { recursive: true, force: true });
              removedPaths.push("evidence/axiom");
              evidenceCleaned = true;
              logger.info(
                `  Removed evidence/axiom for mission '${missionId}' (older than ${evidenceRetentionDays}d)`,
              );
            } else {
              skipped.push("evidence/axiom (within retention period)");
            }
          }
        } catch (err) {
          skipped.push("evidence/axiom (metadata read error — preserved)");
          logger.warn(
            `  Warning: failed to read evidence-metadata.json for mission '${missionId}': ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } else {
      skipped.push("evidence/axiom (not present)");
    }

    return {
      data: { missionId, removedPaths, skipped, evidenceCleaned, evidenceRetentionDays },
      summary: `[mission.cleanup] ${missionId} removed: ${removedPaths.join(", ") || "nothing"}`,
      nextSteps: [
        {
          action: `Close the mission: pnpm exec werkstatt run mission.close --mission ${missionId}`,
          kind: "optional",
        },
      ],
    };
  }

  // --older-than mode: clean workpieces for closed/aborted missions older than threshold
  if (olderThan) {
    const thresholdMs = parseOlderThan(olderThan);
    if (thresholdMs === null) {
      throw new Error(`[mission.cleanup] --older-than must be in format '<N>d' (e.g. '30d')`);
    }

    const missionsDir = path.join(workspaceRoot, "missions");
    if (!existsSync(missionsDir)) {
      return {
        data: { missionId: "*", removedPaths, skipped, evidenceCleaned, evidenceRetentionDays },
        summary: `[mission.cleanup] no missions directory found`,
        nextSteps: [
          {
            action: `List missions: pnpm exec werkstatt run mission.list`,
            kind: "optional",
          },
        ],
      };
    }

    const entries = await fs.readdir(missionsDir, { withFileTypes: true });
    const now = Date.now();

    for (const entry of entries) {
      if (entry.name === "archive") continue;
      if (entry.isSymbolicLink()) continue;
      if (!entry.isDirectory()) continue;
      const missionDir = path.join(missionsDir, entry.name);

      try {
        const manifest = await readMissionManifest(workspaceRoot, entry.name);
        if (manifest.state === "open") {
          skipped.push(`${entry.name} (open)`);
          continue;
        }

        const closedAt = manifest.closedAt;
        if (!closedAt) {
          skipped.push(`${entry.name} (no closedAt)`);
          continue;
        }

        const ageMs = now - new Date(closedAt).getTime();
        if (ageMs < thresholdMs) {
          skipped.push(`${entry.name} (age: ${Math.floor(ageMs / (24 * 60 * 60 * 1000))}d)`);
          continue;
        }

        const workpieceDir = path.join(missionDir, "workpiece");
        const distributionDir = path.join(missionDir, "distribution");

        if (existsSync(workpieceDir)) {
          await fs.rm(workpieceDir, { recursive: true, force: true });
          removedPaths.push(`${entry.name}/workpiece`);
        }
        if (existsSync(distributionDir)) {
          await fs.rm(distributionDir, { recursive: true, force: true });
          removedPaths.push(`${entry.name}/distribution`);
        }

        // RFC-0652: Age-based Axiom evidence cleanup in --older-than mode
        const axiomEvidenceDir = path.join(missionDir, "evidence", "axiom");
        if (evidenceRetentionDays > 0 && existsSync(axiomEvidenceDir)) {
          const metadataPath = path.join(axiomEvidenceDir, "evidence-metadata.json");
          if (existsSync(metadataPath)) {
            try {
              const raw = await fs.readFile(metadataPath, "utf8");
              const meta = JSON.parse(raw) as { runTimestamp?: string };
              if (meta.runTimestamp) {
                const runTime = new Date(meta.runTimestamp).getTime();
                const cutoff = Date.now() - evidenceRetentionDays * 24 * 60 * 60 * 1000;
                if (runTime < cutoff) {
                  await fs.rm(axiomEvidenceDir, { recursive: true, force: true });
                  removedPaths.push(`${entry.name}/evidence/axiom`);
                  evidenceCleaned = true;
                }
              }
            } catch {
              // metadata read error — preserve evidence
            }
          }
        }
      } catch {
        skipped.push(`${entry.name} (no manifest)`);
      }
    }

    logger.info(`  Cleaned ${removedPaths.length} path(s), skipped ${skipped.length}`);
  }

  return {
    data: { missionId: "*", removedPaths, skipped, evidenceCleaned, evidenceRetentionDays },
    summary: `[mission.cleanup] removed: ${removedPaths.length}, skipped: ${skipped.length}`,
    nextSteps: [
      {
        action: `List remaining missions: pnpm exec werkstatt run mission.list`,
        kind: "optional",
      },
    ],
  };
}
