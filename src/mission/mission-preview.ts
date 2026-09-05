/*
<MODULE_CONTRACT>
<purpose>RFC-0480: mission.preview — blocking dev server for any mission (open, closed, aborted).</purpose>
<non-goals>
  <item>Does not build — use mission.build for that.</item>
  <item>Does not validate — use mission.validate for that.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0480: extracted mission.preview to its own file; blocking astro dev/preview server; works for closed/aborted missions.</item>
  <item>ADR-0007: run content.ref-index.generate before dev server start to ensure fresh content reference index.</item>
  <item>Pre-dev critical file check: verify content-ref-index, derived-prices, and video-manifest exist before starting dev. Auto-generate missing files via executeKernelCommand. Block with actionable error if generation fails. --skip-prepare flag for fast restarts.</item>
  <item>RFC-0817: enforce materialization gate — auto-run mission.materialize when materializedAt is null and mission state is open. --skip-prepare does NOT bypass materialization.</item>
</CHANGE_SUMMARY>
*/

import { existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import type {
  DiscoveredSiteWorkspace,
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { executeKernelCommand } from "@warpgogol/werkstatt-engine/kernel";
import { readMissionManifest, resolveMissionDir } from "./mission-io.ts";

interface DevCriticalFile {
  readonly path: string;
  readonly command: string;
  readonly description: string;
  readonly prerequisites?: readonly string[];
}

const DEV_CRITICAL_FILES: readonly DevCriticalFile[] = [
  {
    path: "src/content-ref-index.generated.yaml",
    command: "content.ref-index.generate",
    description: "Content reference index (resolves =(...) formula references in page props)",
  },
  {
    path: "src/derived-prices.generated.json",
    command: "derived-prices.materialize",
    description: "Derived prices (currency-aware price display)",
    prerequisites: ["entitlements.resolve", "rate-snapshot.resolve", "currency-pricing.compile"],
  },
  {
    path: "src/video-manifest.generated.yaml",
    command: "video.variants.generate",
    description: "Video manifest (video section rendering)",
  },
];

async function ensureDevCriticalFiles(
  workpiecePath: string,
  systemId: string,
  workspaceRoot: string,
  logger: KernelRuntimeContext["logger"],
): Promise<void> {
  const missing: DevCriticalFile[] = [];
  for (const entry of DEV_CRITICAL_FILES) {
    const fullPath = path.join(workpiecePath, entry.path);
    if (!existsSync(fullPath)) {
      missing.push(entry);
    }
  }

  if (missing.length === 0) return;

  logger.info(
    `  [pre-dev] ${missing.length} critical generated file(s) missing — auto-generating…`,
  );
  for (const entry of missing) {
    logger.info(`    - ${entry.path} (${entry.description})`);
  }

  for (const entry of missing) {
    if (entry.prerequisites) {
      for (const prereq of entry.prerequisites) {
        logger.info(`  [pre-dev] Running prerequisite: ${prereq}…`);
        try {
          const execResult = await executeKernelCommand({
            workspaceRoot,
            commandName: prereq,
            siteName: systemId,
          });
          const single = Array.isArray(execResult) ? execResult[0] : execResult;
          if (!single?.ok) {
            throw new Error(
              `[mission.preview] Prerequisite "${prereq}" failed for "${entry.path}". ` +
                `This file is required for dev: ${entry.description}. ` +
                `Fix the error above and re-run mission.preview. ` +
                `To skip this check, use --skip-prepare (not recommended — the dev server will render without ${entry.description}).`,
            );
          }
        } catch (err) {
          if (err instanceof Error && err.message.startsWith("[mission.preview]")) throw err;
          throw new Error(
            `[mission.preview] Prerequisite "${prereq}" threw for "${entry.path}": ${err instanceof Error ? err.message : String(err)}. ` +
              `This file is required for dev: ${entry.description}. ` +
              `Fix the error above and re-run mission.preview. ` +
              `To skip this check, use --skip-prepare (not recommended).`,
          );
        }
      }
    }

    logger.info(`  [pre-dev] Generating: ${entry.command}…`);
    try {
      const execResult = await executeKernelCommand({
        workspaceRoot,
        commandName: entry.command,
        siteName: systemId,
      });
      const single = Array.isArray(execResult) ? execResult[0] : execResult;
      if (!single?.ok) {
        throw new Error(
          `[mission.preview] "${entry.command}" failed to generate "${entry.path}". ` +
            `This file is required for dev: ${entry.description}. ` +
            `Fix the error above and re-run mission.preview. ` +
            `To skip this check, use --skip-prepare (not recommended — the dev server will render without ${entry.description}).`,
        );
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("[mission.preview]")) throw err;
      throw new Error(
        `[mission.preview] "${entry.command}" threw while generating "${entry.path}": ${err instanceof Error ? err.message : String(err)}. ` +
          `This file is required for dev: ${entry.description}. ` +
          `Fix the error above and re-run mission.preview. ` +
          `To skip this check, use --skip-prepare (not recommended).`,
      );
    }

    const fullPath = path.join(workpiecePath, entry.path);
    if (!existsSync(fullPath)) {
      throw new Error(
        `[mission.preview] "${entry.command}" completed but "${entry.path}" was not created. ` +
          `This file is required for dev: ${entry.description}. ` +
          `Investigate why the generator did not write the file and re-run mission.preview. ` +
          `To skip this check, use --skip-prepare (not recommended).`,
      );
    }
    logger.info(`  [pre-dev] OK: ${entry.path}`);
  }

  logger.info(`  [pre-dev] All critical generated files present.`);
}

export interface MissionPreviewData {
  missionId: string;
  systemId: string;
  workpiecePath: string;
  port: number;
  production: boolean;
}

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

function flagBool(input: KernelCommandInput, key: string): boolean {
  const v = input.flags[key];
  return v === true || v === "true";
}

export async function runMissionPreview(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<MissionPreviewData>> {
  const { workspaceRoot, logger } = context;
  const missionId = flagString(input, "mission");
  const port = parseInt(flagString(input, "port") ?? "4321", 10);
  const production = flagBool(input, "production");
  const skipPrepare = flagBool(input, "skip-prepare");

  if (!missionId) throw new Error("[mission.preview] --mission is required");

  const manifest = await readMissionManifest(workspaceRoot, missionId);

  // RFC-0480: preview works for open, closed, and aborted missions
  const workpiecePath = path.join(resolveMissionDir(workspaceRoot, missionId), "workpiece");

  if (!existsSync(workpiecePath)) {
    throw new Error(
      `[mission.preview] workpiece not found for mission '${missionId}' — run mission.materialize first`,
    );
  }

  // RFC-0817: Materialization gate — if the mission is open and has not been
  // materialized yet, auto-run mission.materialize before starting the dev server.
  // This ensures ownership map gaps, generated file issues, and pipeline step
  // failures are caught at preview time, not hours later at mission.close.
  // --skip-prepare does NOT bypass this gate — materialization is the formal
  // lifecycle gate, not a convenience check.
  if (manifest.state === "open" && !manifest.materializedAt) {
    logger.info(
      `  [mission.preview] Mission '${missionId}' is open but not materialized (materializedAt is null). ` +
        `Auto-running mission.materialize before starting dev server…`,
    );
    try {
      const materializeResult = await executeKernelCommand({
        workspaceRoot,
        commandName: "mission.materialize",
        siteName: manifest.systemId,
      });
      const single = Array.isArray(materializeResult) ? materializeResult[0] : materializeResult;
      if (!single?.ok) {
        throw new Error(
          `[mission.preview] mission.materialize failed for mission '${missionId}'. ` +
            `The dev server cannot start until materialization succeeds. ` +
            `Fix the error above and re-run mission.preview. ` +
            `Materialization is the formal lifecycle gate — --skip-prepare does NOT bypass it.`,
        );
      }
      logger.info(`  [mission.preview] Materialization complete.`);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("[mission.preview]")) throw err;
      throw new Error(
        `[mission.preview] mission.materialize threw for mission '${missionId}': ${err instanceof Error ? err.message : String(err)}. ` +
          `The dev server cannot start until materialization succeeds. ` +
          `Fix the error above and re-run mission.preview. ` +
          `Materialization is the formal lifecycle gate — --skip-prepare does NOT bypass it.`,
      );
    }
  }

  const cmd = production ? "preview" : "dev";

  // Stop any existing astro dev server on this port before starting a new one
  spawnSync("pnpm", ["run", "stop"], {
    cwd: workpiecePath,
    stdio: "ignore",
  });

  if (!skipPrepare) {
    // Pre-dev critical file check: verify that generated files required for
    // correct dev rendering exist, and auto-generate them if missing.
    // This catches issues like missing prices (derived-prices.generated.json)
    // or missing videos (video-manifest.generated.yaml) before the dev server
    // starts, preventing silent rendering failures.
    await ensureDevCriticalFiles(workpiecePath, manifest.systemId, workspaceRoot, logger);
  } else {
    logger.warn(
      `  [mission.preview] --skip-prepare: skipping critical file check. ` +
        `If prices, videos, or formula references are missing, remove --skip-prepare and re-run.`,
    );
  }

  // ADR-0007: regenerate content reference index before dev server start
  // so the resolver reads fresh frontmatter values from source files.
  // Call in-process with a synthetic site context pointing to the workpiece,
  // not via --site flag (which relies on registry currentMission and fails
  // for closed/aborted missions where currentMission is cleared).
  const workpieceSite: DiscoveredSiteWorkspace = {
    name: manifest.systemId,
    directory: workpiecePath,
    toolsDirectory: path.join(workpiecePath, "tools"),
  };
  try {
    const codegenModule = "@warpgogol/werkstatt-site/codegen";
    const { runContentRefIndexGenerate } = await import(codegenModule);
    await runContentRefIndexGenerate({ argv: [], flags: {} }, { ...context, site: workpieceSite });
  } catch (err) {
    logger.warn(
      `  [ADR-0007] content.ref-index.generate failed: ${err instanceof Error ? err.message : String(err)} — index may be stale`,
    );
  }

  logger.info(
    `  Starting astro ${cmd} on port ${port} for mission '${missionId}' (state: ${manifest.state})`,
  );
  logger.info(`  Workpiece: ${workpiecePath}`);
  logger.info(`  Press Ctrl+C to stop the server.`);

  return new Promise((resolve) => {
    const child = spawn("pnpm", ["exec", "astro", cmd, "--port", String(port)], {
      cwd: workpiecePath,
      stdio: "inherit",
    });

    child.on("exit", (code) => {
      resolve({
        data: {
          missionId,
          systemId: manifest.systemId,
          workpiecePath,
          port,
          production,
        },
        summary: `[mission.preview] ${missionId} server stopped (exit code: ${code})`,
      });
    });

    child.on("error", (err) => {
      resolve({
        data: {
          missionId,
          systemId: manifest.systemId,
          workpiecePath,
          port,
          production,
        },
        summary: `[mission.preview] ${missionId} server error: ${err.message}`,
      });
    });
  });
}
