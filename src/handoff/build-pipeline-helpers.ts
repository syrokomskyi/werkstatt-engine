/*
<MODULE_CONTRACT>
<purpose>Shared helpers for the three-phase build pipeline (build.prepare → astro build → build.post) used by mission.build, mission.validate, and release.prepare. Centralizes pipeline execution and build-input-hash computation to eliminate duplication.</purpose>
<non-goals>
  <item>Does not define pipeline composition or command registration — that lives in site-kernel-checks pipelines.</item>
  <item>Does not run astro build directly — callers own the execSync call between build.prepare and build.post.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>ADR-0008: extracted runPipelinePhase and computeBuildInputHash from mission-materialization-commands.ts and release-commands.ts to eliminate 5x duplicated pipeline execution pattern and 2x duplicated build-input-hash computation.</item>
  <item>Fix: add writePreliminaryBuildIdentity/cleanupPreliminaryBuildIdentity helpers so mission.build and mission.validate write build-identity.json before astro build, enabling the open-source-registry-section component to embed deployment metadata at build time.</item>
</CHANGE_SUMMARY>
*/
import path from "node:path";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import * as fs from "node:fs/promises";
import type { DiscoveredSiteWorkspace, KernelPipelineReport } from "@warpgogol/werkstatt-engine/kernel";
import { executeKernelPipeline } from "@warpgogol/werkstatt-engine/kernel";
import { fingerprintTree } from "@warpgogol/werkstatt-engine/fingerprint/semantic";
import { byteHash } from "@warpgogol/werkstatt-engine/fingerprint";
import { atomicWriteFile } from "../werkstatt/atomic.ts";
import { resolveCurrentEcosystem, resolvePlatformSemanticHash } from "./bundle-io.ts";

/**
 * Runs a kernel pipeline phase and throws a descriptive error if it fails.
 * Centralizes the executeKernelPipeline → unwrap → ok-check → format-failings pattern
 * that is used by mission.build, mission.validate, and release.prepare.
 * When `siteWorkspace` is provided, bypasses site discovery (needed for closed-mission
 * workpieces where registry.currentMission is null).
 */
export async function runPipelinePhase(
  workspaceRoot: string,
  pipelineName: string,
  siteName: string,
  siteWorkspace?: DiscoveredSiteWorkspace,
): Promise<KernelPipelineReport> {
  const result = await executeKernelPipeline({
    workspaceRoot,
    pipelineName,
    siteName,
    outputFormat: "pretty",
    siteWorkspace,
  });
  const report: KernelPipelineReport = Array.isArray(result) ? result[0] : result;
  if (!report.ok) {
    const failed = report.steps
      .filter((s) => !s.ok)
      .map((s) => `${s.commandName} (exit ${s.exitCode})`);
    throw new Error(`${pipelineName} failed: ${failed.join(", ")}`);
  }
  return report;
}

export interface BuildInputHashResult {
  buildInputHash: string;
  workpieceTreeHash: string;
  platformVersion: string;
  platformSemanticHash: string;
}

/**
 * Computes the build input hash for a workpiece directory.
 * Centralizes the content-tree-hash + platform-version + platform-semantic-hash
 * computation used by mission.build (to write build-input-hash.json) and
 * release.prepare (to decide whether to reuse a distribution).
 * Returns intermediate values so release.prepare can populate the release manifest.
 */
export async function computeBuildInputHash(
  workspaceRoot: string,
  workpieceDir: string,
): Promise<BuildInputHashResult> {
  const { version: platformVersion } = await resolveCurrentEcosystem(workspaceRoot);
  const platformSemanticHash = await resolvePlatformSemanticHash(workspaceRoot);
  const contentDir = path.join(workpieceDir, "src", "content");
  let workpieceTreeHash = "sha256:absent";
  if (existsSync(contentDir)) {
    const contentResult = await fingerprintTree(contentDir, { mode: "semantic" });
    workpieceTreeHash = contentResult.value;
  }
  const buildInputHash = byteHash(
    `${workpieceTreeHash}|${platformVersion}|${platformSemanticHash}`,
  );
  return { buildInputHash, workpieceTreeHash, platformVersion, platformSemanticHash };
}

export interface PreliminaryBuildIdentityFields {
  releaseId: string;
  systemId: string;
  missionId: string;
  semver: string;
}

/**
 * Writes a preliminary build-identity.json to workpiece/public/.well-known/ before
 * astro build so the open-source-registry-section.astro component can read deployment
 * metadata (releaseId, buildTimestamp, commitSha) at build time. Without this file,
 * the component falls back to placeholder values ("—") which text.normalize.apply
 * later converts to "-" in the prerendered HTML.
 *
 * Returns the file path for later cleanup via cleanupPreliminaryBuildIdentity.
 */
export async function writePreliminaryBuildIdentity(
  workpieceDir: string,
  fields: PreliminaryBuildIdentityFields,
  logger: { info: (msg: string) => void },
): Promise<string> {
  let commitSha = "0000000";
  try {
    commitSha = execSync("git rev-parse HEAD", {
      cwd: workpieceDir,
      encoding: "utf-8",
      stdio: "pipe",
    }).trim();
  } catch {
    // Workpiece may not be a git repo — use placeholder
  }

  const publicWellKnownDir = path.join(workpieceDir, "public", ".well-known");
  await fs.mkdir(publicWellKnownDir, { recursive: true });
  const preliminary = {
    releaseId: fields.releaseId,
    systemId: fields.systemId,
    missionId: fields.missionId,
    semver: fields.semver,
    distTreeHash: "",
    behaviorSnapshotHash: "",
    siteContentHash: "",
    platformVersion: "",
    platformSemanticHash: "",
    commitSha,
    buildTimestamp: new Date().toISOString(),
    targetPlatform: "cloudflare-workers",
  };
  const filePath = path.join(publicWellKnownDir, "build-identity.json");
  await atomicWriteFile(filePath, JSON.stringify(preliminary, null, 2) + "\n");
  logger.info(`  Wrote preliminary build-identity.json to workpiece/public/.well-known/`);
  return filePath;
}

/**
 * Removes the preliminary build-identity.json from workpiece/public/.well-known/
 * after build.post completes. The copy in dist/client/.well-known/ is left intact —
 * release.prepare overwrites it with the final build-identity.json.
 */
export async function cleanupPreliminaryBuildIdentity(filePath: string): Promise<void> {
  await fs.rm(filePath, { force: true });
}
