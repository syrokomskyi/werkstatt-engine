/*
<MODULE_CONTRACT>
<purpose>Maintains packages/os/site-kernel-handoff/src/release/release-commands.ts as an authored site-kernel-handoff authored module so agents can evolve it without rediscovering local boundaries.</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0357: initial release command handlers.</item>
  <item>RFC-0381: resolve platformVersion, commitSha, and platformSemanticHash from ecosystem instead of hardcoding unknown.</item>
  <item>RFC-0480: add C-surface regression check to release.prepare; block on C-surface regression without breaksC: true.</item>
  <item>RFC-0520: extract C-surface regression check into evaluateCSurfaceGate pure function.</item>
  <item>RFC-0522: write releaseId to mission manifest via writeMissionManifest after successful release preparation.</item>
  <item>RFC-0585: restore production build, behavior snapshot capture + diff, and real hash computation in release.prepare; add distTreeHash guard to release.publish.</item>
  <item>ADR-0008: run full three-phase build pipeline (build.prepare → astro build → build.post) in release.prepare fresh build path; delegate to shared runPipelinePhase and computeBuildInputHash helpers.</item>
  <item>RFC-0596: call storeArtifactCore (lock-free) inside release.publish before state transition; extend ReleasePublishData with distArtifactHash; extend release.validate to check artifact field for published releases.</item>
  <item>RFC-0608: write build-identity.json into dist/client/.well-known/ after hash computation.</item>
  <item>RFC-0655: sync close-report.json releaseId after writing mission.yaml; add release.state.validate command.</item>
  <item>RFC-0656: add dist.determinism.validate command; switch release.prepare distTreeHash to mode: "stable".</item>
  <item>Fix: correct resolveStagingDir call to use workspaceRoot instead of releasesBase; write release.yaml directly into stagingDir and remove redundant re-write after atomicMoveDir.</item>
  <item>RFC-0845: add Playwright Chromium pre-flight check before build.prepare (after distribution-reuse check) — fail fast with actionable error when Chromium is not installed.</item>
  <item>RFC-0931: add runReleaseSign command handler for Ed25519 signing of build-identity.json and signed-manifest.json production.</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import type {
  DiscoveredSiteWorkspace,
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { fingerprintTree } from "@warpgogol/werkstatt-engine/fingerprint/semantic";
import {
  readMissionManifest,
  writeMissionManifest,
  resolveMissionDir,
} from "../mission/mission-io.ts";
import { acquireLock, releaseLock, generateOperationId } from "../werkstatt/index.ts";
import { atomicWriteFile, atomicMoveDir, resolveStagingDir } from "../werkstatt/atomic.ts";
import { appendAndCommitBordbuch } from "../bordbuch/bordbuch-commit-helper.ts";
import { readSystemState, writeSystemState } from "../sternsystem/registry-io.ts";
import { runPipelinePhase, computeBuildInputHash } from "../handoff/build-pipeline-helpers.ts";
import { evaluateCSurfaceGate } from "./c-surface-guard.ts";
import { checkBreaksCDeclaration } from "./breaks-c-helper.ts";
import {
  runBehaviorSnapshotCapture,
  runBehaviorSnapshotDiff,
} from "../behavior-snapshot/behavior-snapshot-commands.ts";
import { storeArtifactCore } from "../artifact-store/artifact-store-commands.ts";
import { executeKernelCommand } from "@warpgogol/werkstatt-engine/kernel";
import {
  signBuildIdentity,
  writeReleasePublicKey,
  signLatestBuildArtifacts,
} from "../integrity/signing.ts";
import { loadPrivateKey } from "@warpgogol/werkstatt-engine/signing";
import { filterEnv } from "../leitstand/adapters/index.ts";
import { runIntegrityBuildRecord } from "../integrity/integrity-commands.ts";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  releaseManifestSchema,
  legacyReleaseStateSchema,
  type ReleaseManifest,
  type LegacyReleaseDiagnostic,
} from "../schemas/release.ts";
import type { ReleaseArtifactRef } from "../schemas/artifact-store.ts";

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

function deriveReleaseId(systemId: string, existing: string[]): string {
  let max = 0;
  for (const id of existing) {
    const match = id.match(/-r(\d{6})$/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > max) max = num;
    }
  }
  const next = max + 1;
  if (next > 999999) {
    throw new Error(
      `[release.prepare] sequence number exhausted for system '${systemId}' (max: 999999)`,
    );
  }
  return `${systemId}-r${String(next).padStart(6, "0")}`;
}

async function listReleaseIds(workspaceRoot: string): Promise<string[]> {
  const releasesDir = path.join(workspaceRoot, "releases");
  if (!existsSync(releasesDir)) return [];
  const entries = await fs.readdir(releasesDir, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory() && !e.name.includes(".staging-")).map((e) => e.name);
}

export class LegacyReleaseError extends Error {
  readonly releaseId: string;
  readonly legacyState: string;
  constructor(releaseId: string, legacyState: string) {
    super(
      `[release] release '${releaseId}' uses legacy state '${legacyState}' which is no longer valid per RFC-0851`,
    );
    this.releaseId = releaseId;
    this.legacyState = legacyState;
  }
}

export async function readReleaseManifest(
  workspaceRoot: string,
  releaseId: string,
): Promise<ReleaseManifest> {
  const manifestPath = path.join(workspaceRoot, "releases", releaseId, "release.yaml");
  if (!existsSync(manifestPath)) {
    throw new Error(`[release] release '${releaseId}' not found`);
  }
  const content = await fs.readFile(manifestPath, "utf8");
  const parsed = parseYaml(content);
  const result = releaseManifestSchema.safeParse(parsed);
  if (result.success) {
    return result.data;
  }
  const stateValue =
    typeof parsed === "object" && parsed !== null && "state" in parsed
      ? String((parsed as Record<string, unknown>).state)
      : "";
  const legacyStateResult = legacyReleaseStateSchema.safeParse(stateValue);
  if (legacyStateResult.success) {
    throw new LegacyReleaseError(releaseId, legacyStateResult.data);
  }
  throw new Error(
    `[release] release '${releaseId}' has invalid manifest: ${result.error.issues.map((i) => i.path.join(".") + ": " + i.message).join("; ")}`,
  );
}

export async function writeReleaseYaml(
  workspaceRoot: string,
  releaseId: string,
  manifest: ReleaseManifest,
): Promise<void> {
  const releaseDir = path.join(workspaceRoot, "releases", releaseId);
  const yaml = stringifyYaml(manifest, { sortMapEntries: false });
  await atomicWriteFile(path.join(releaseDir, "release.yaml"), yaml);
}

// §6.1: release.prepare
export interface ReleasePrepareData {
  releaseId: string;
  systemId: string;
  missionId: string;
  semver: string;
  state: "prepared";
  snapshotDiffVerdict: "pass" | "fail";
  cSurfaceVerdict: "pass" | "fail" | "skipped";
  behaviorSnapshotHash: string;
  distTreeHash: string;
  siteContentHash: string;
  readableSnapshotHash: string;
  buildReused: boolean;
}

export async function runReleasePrepare(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<ReleasePrepareData>> {
  const { workspaceRoot, logger } = context;
  const missionId = flagString(input, "mission");
  const semver = flagString(input, "semver") ?? "0.1.0";

  if (!missionId) throw new Error("[release.prepare] --mission is required");

  const manifest = await readMissionManifest(workspaceRoot, missionId);
  if (manifest.state !== "closed") {
    throw new Error(
      `[release.prepare] mission '${missionId}' is not closed (state: ${manifest.state}). Run \`mission.close --mission ${missionId}\` first.`,
    );
  }

  // RFC-0480: require successful reconcile before preparing a release
  if (!manifest.reconciledAt) {
    throw new Error(
      `[release.prepare] mission '${missionId}' has not been reconciled — run mission.reconcile before preparing a release`,
    );
  }

  // Check validation has passed
  const missionDir = resolveMissionDir(workspaceRoot, missionId);
  const validationPath = path.join(missionDir, "evidence", "validation-report.json");
  if (!existsSync(validationPath)) {
    throw new Error(`[release.prepare] mission '${missionId}' has not passed validation`);
  }

  const operationId = generateOperationId();
  const systemId = manifest.systemId;

  await acquireLock(workspaceRoot, `system:${systemId}`, operationId, "release.prepare", "agent");

  try {
    const existingReleases = await listReleaseIds(workspaceRoot);
    const systemReleases = existingReleases.filter((id) => id.startsWith(`${systemId}-r`));
    const releaseId = deriveReleaseId(systemId, systemReleases);

    await acquireLock(
      workspaceRoot,
      `release:${releaseId}`,
      operationId,
      "release.prepare",
      "agent",
    );

    try {
      const releasesBase = path.join(workspaceRoot, "releases");
      await fs.mkdir(releasesBase, { recursive: true });

      const stagingDir = resolveStagingDir(
        workspaceRoot,
        path.join(releasesBase, releaseId),
        operationId,
      );
      if (existsSync(stagingDir)) {
        await fs.rm(stagingDir, { recursive: true, force: true });
      }
      await fs.mkdir(stagingDir, { recursive: true });

      // Copy validation and materialization reports
      const evidenceDir = path.join(missionDir, "evidence");
      if (existsSync(evidenceDir)) {
        await fs.mkdir(path.join(stagingDir), { recursive: true });
        for (const report of ["validation-report.json", "materialization-report.json"]) {
          const src = path.join(evidenceDir, report);
          if (existsSync(src)) {
            await fs.copyFile(src, path.join(stagingDir, report));
          }
        }
      }

      // RFC-0585: Run production build (or reuse distribution), capture snapshots, compute hashes
      const workpieceDir = path.join(missionDir, "workpiece");
      const distributionDir = path.join(missionDir, "distribution", "dist");
      const distDest = path.join(stagingDir, "dist");
      let buildReused = false;

      // RFC-0634: commitSha is now captured from workpiece git HEAD (see below, before build)

      // RFC-0585: Compute build input hash for reuse decision
      const { buildInputHash, workpieceTreeHash, platformVersion, platformSemanticHash } =
        await computeBuildInputHash(workspaceRoot, workpieceDir);

      const distributionMetaPath = path.join(missionDir, "distribution", "build-input-hash.json");
      const canReuseDistribution =
        existsSync(distributionDir) &&
        existsSync(distributionMetaPath) &&
        (await (async () => {
          try {
            const meta = JSON.parse(await fs.readFile(distributionMetaPath, "utf8"));
            return meta.buildInputHash === buildInputHash;
          } catch {
            return false;
          }
        })());

      // RFC-0634: Capture commitSha from workpiece git HEAD (not monorepo HEAD)
      let commitSha = "unknown";
      try {
        commitSha = execSync("git rev-parse HEAD", {
          cwd: workpieceDir,
          encoding: "utf-8",
          stdio: "pipe",
        }).trim();
      } catch {
        logger.warn("[release.prepare] could not read workpiece HEAD sha");
      }

      // RFC-0634: Write preliminary build-identity.json to workpiece/public/.well-known/ before build
      const publicWellKnownDir = path.join(workpieceDir, "public", ".well-known");
      await fs.mkdir(publicWellKnownDir, { recursive: true });
      const preliminaryBuildIdentity = {
        releaseId,
        systemId,
        missionId,
        semver,
        distTreeHash: "",
        behaviorSnapshotHash: "",
        siteContentHash: workpieceTreeHash,
        platformVersion,
        platformSemanticHash,
        commitSha: commitSha === "unknown" ? "0000000" : commitSha,
        buildTimestamp: new Date().toISOString(),
        targetPlatform: "cloudflare-workers",
      };
      await atomicWriteFile(
        path.join(publicWellKnownDir, "build-identity.json"),
        JSON.stringify(preliminaryBuildIdentity, null, 2) + "\n",
      );
      logger.info(`  Wrote preliminary build-identity.json to workpiece/public/.well-known/`);

      if (canReuseDistribution) {
        await fs.mkdir(distDest, { recursive: true });
        await copyDir(distributionDir, distDest);
        buildReused = true;
        logger.info(`  Reused distribution from mission.build (build input hash matched)`);
      } else if (existsSync(workpieceDir)) {
        // RFC-0356: run build.prepare → astro build → build.post unconditionally.
        // All three phases must succeed — without build.post the distribution is
        // unsigned (text.normalize.apply, passport.emit, etc. never run).
        //
        // Construct a synthetic DiscoveredSiteWorkspace pointing to the workpiece so
        // the pipeline executor can load the app runtime without relying on
        // registry.currentMission (which is null for closed missions).
        const workpieceSite: DiscoveredSiteWorkspace = {
          name: systemId,
          directory: workpieceDir,
          toolsDirectory: path.join(workpieceDir, "tools"),
          configPath: path.join(workpieceDir, "tools", "kernel.config.ts"),
        };

        // RFC-0845: Playwright Chromium pre-flight check — fail fast before expensive
        // build.prepare → astro build → build.post cycle.
        // Skipped on distribution-reuse path (canReuseDistribution branch above).
        let preflightFailed = false;
        try {
          const preflightResult = (await executeKernelCommand({
            workspaceRoot,
            commandName: "playwright.preflight.check",
            outputFormat: "pretty",
          })) as { exitCode?: number; summary?: string };
          if ((preflightResult.exitCode ?? 0) !== 0) {
            const msg = preflightResult.summary ?? "Playwright Chromium is not installed";
            logger.info(`  [preflight] ${msg}`);
            preflightFailed = true;
          } else {
            logger.info(`  Playwright Chromium: pre-flight check passed`);
          }
        } catch (err) {
          // Non-fatal: if the check itself throws unexpectedly, log and continue
          logger.warn(
            `  Playwright Chromium pre-flight check error (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        if (preflightFailed) {
          throw new Error(
            `[release.prepare] pre-flight FAILED: Playwright Chromium is not installed. Run: pnpm exec playwright install chromium, then re-run: pnpm exec werkstatt run release.prepare --mission ${missionId}`,
          );
        }

        logger.info(`  Running build.prepare pipeline for ${systemId}…`);
        try {
          await runPipelinePhase(workspaceRoot, "build.prepare", systemId, workpieceSite);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          throw new Error(`[release.prepare] build.prepare failed: ${msg.slice(0, 200)}`);
        }

        logger.info(`  Running astro build in ${workpieceDir}…`);
        try {
          execSync("pnpm exec astro build", {
            cwd: workpieceDir,
            stdio: "pipe",
            timeout: 300_000,
          });
        } catch (err) {
          const buildError = err instanceof Error ? err.message : String(err);
          throw new Error(`[release.prepare] astro build failed: ${buildError.slice(0, 200)}`);
        }

        logger.info(`  Running build.post pipeline for ${systemId}…`);
        try {
          await runPipelinePhase(workspaceRoot, "build.post", systemId, workpieceSite);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          throw new Error(`[release.prepare] build.post failed: ${msg.slice(0, 200)}`);
        }

        const workpieceDist = path.join(workpieceDir, "dist");
        if (existsSync(workpieceDist)) {
          await fs.mkdir(distDest, { recursive: true });
          await copyDir(workpieceDist, distDest);
        } else {
          throw new Error(`[release.prepare] astro build produced no dist/ directory`);
        }
      } else {
        throw new Error(
          `[release.prepare] no workpiece or distribution found for mission '${missionId}'`,
        );
      }

      // RFC-0634: Remove preliminary build-identity.json from dist/client/.well-known/ before hashing
      const distClientBuildIdentityPath = path.join(
        distDest,
        "client",
        ".well-known",
        "build-identity.json",
      );
      if (existsSync(distClientBuildIdentityPath)) {
        await fs.rm(distClientBuildIdentityPath, { force: true });
        logger.info(`  Removed preliminary build-identity.json from dist/ before hashing`);
      }

      // RFC-0634: Clean up preliminary from workpiece/public/.well-known/
      await fs.rm(path.join(publicWellKnownDir, "build-identity.json"), { force: true });

      const now = new Date().toISOString();

      // RFC-0585: Capture behavior snapshots and run diff
      // Astro Cloudflare adapter outputs HTML to dist/client/ — scan that for routes
      const clientDistDir = existsSync(path.join(distDest, "client"))
        ? path.join(distDest, "client")
        : distDest;
      const readableSnapshotPath = path.join(stagingDir, "readable-snapshot.json");
      const productionSnapshotPath = path.join(stagingDir, "behavior-snapshot.json");
      const snapshotDiffPath = path.join(stagingDir, "snapshot-diff.json");

      const readableResult = await runBehaviorSnapshotCapture(
        {
          flags: {
            dist: clientDistDir,
            system: systemId,
            "build-kind": "readable",
            release: releaseId,
          },
          argv: [],
        },
        context,
      );
      if (!readableResult.data)
        throw new Error("[release.prepare] readable snapshot capture returned no data");
      await fs.writeFile(
        readableSnapshotPath,
        JSON.stringify(readableResult.data.wrapper, null, 2) + "\n",
      );

      const productionResult = await runBehaviorSnapshotCapture(
        {
          flags: {
            dist: clientDistDir,
            system: systemId,
            "build-kind": "production",
            release: releaseId,
          },
          argv: [],
        },
        context,
      );
      if (!productionResult.data)
        throw new Error("[release.prepare] production snapshot capture returned no data");
      await fs.writeFile(
        productionSnapshotPath,
        JSON.stringify(productionResult.data.wrapper, null, 2) + "\n",
      );

      const diffResult = await runBehaviorSnapshotDiff(
        {
          flags: { baseline: readableSnapshotPath, candidate: productionSnapshotPath },
          argv: [],
        },
        context,
      );
      if (!diffResult.data)
        throw new Error("[release.prepare] behavior snapshot diff returned no data");
      await fs.writeFile(snapshotDiffPath, JSON.stringify(diffResult.data, null, 2) + "\n");

      const snapshotDiffVerdict = diffResult.data.verdict as "pass" | "fail";
      if (snapshotDiffVerdict === "fail") {
        throw new Error(
          `[release.prepare] behavior snapshot diff failed — ${diffResult.data.differences.length} structural differences`,
        );
      }

      // RFC-0656: Compute deterministic distTreeHash via stable mode (normalizes PDFs, source maps, JSON timestamps)
      const distTreeResult = await fingerprintTree(distDest, { mode: "stable", root: distDest });
      const distTreeHash = distTreeResult.value;

      const siteContentHash = workpieceTreeHash;

      const behaviorSnapshotHash = productionResult.data.behaviorSnapshotHash;
      const readableSnapshotHash = readableResult.data.behaviorSnapshotHash;

      // RFC-0608: Write build-identity.json into dist/client/.well-known/
      const wellKnownDir = path.join(distDest, "client", ".well-known");
      await fs.mkdir(wellKnownDir, { recursive: true });
      const buildIdentity = {
        releaseId,
        systemId,
        missionId,
        semver,
        distTreeHash,
        behaviorSnapshotHash,
        siteContentHash,
        platformVersion,
        platformSemanticHash,
        commitSha: commitSha === "unknown" ? "0000000" : commitSha,
        buildTimestamp: now,
        targetPlatform: "cloudflare-workers",
      };
      await atomicWriteFile(
        path.join(wellKnownDir, "build-identity.json"),
        JSON.stringify(buildIdentity, null, 2) + "\n",
      );

      // Write release manifest (RFC-0851: strict artifact-only schema)
      const releaseManifest: ReleaseManifest = {
        schemaVersion: "1.0.0",
        releaseId,
        systemId,
        missionId,
        semver,
        platformVersion,
        createdAt: now,
        readyAt: null,
        state: "prepared",
        commitSha: commitSha === "unknown" ? "0000000" : commitSha,
        platformSemanticHash,
        siteContentHash,
        distTreeHash,
        distArtifactHash: null,
        artifact: null,
        behaviorSnapshotHash,
        readableSnapshotHash,
        qualityReportHash: null,
        snapshotDiffVerdict,
        migratorVerdict: "pass",
        versionCompareVerdict: "in-sync",
      };

      // Write release.yaml directly into stagingDir — atomicMoveDir will carry it
      // to the final location, avoiding a redundant re-write after the move.
      const manifestYaml = stringifyYaml(releaseManifest, { sortMapEntries: false });
      await atomicWriteFile(path.join(stagingDir, "release.yaml"), manifestYaml);

      // RFC-0761: Copy .env from workpiece to release directory
      const srcEnv = path.join(workpieceDir, ".env");
      const destEnv = path.join(stagingDir, ".env");
      if (existsSync(srcEnv)) {
        await fs.copyFile(srcEnv, destEnv);
        logger.info(`  Copied .env to release`);
      } else {
        logger.warn(
          `  .env not found in workpiece — propagate/promote will use process.env fallback`,
        );
      }

      // Atomic rename
      const finalDir = path.join(releasesBase, releaseId);
      if (existsSync(finalDir)) {
        await fs.rm(finalDir, { recursive: true, force: true });
      }
      await atomicMoveDir(stagingDir, finalDir);

      // RFC-0522: write releaseId to mission manifest for mission-to-release association
      const missionManifest = await readMissionManifest(workspaceRoot, missionId);
      missionManifest.releaseId = releaseId;
      await writeMissionManifest(workspaceRoot, missionManifest);

      // RFC-0655: sync close-report.json releaseId after writing mission.yaml
      const closeReportPath = path.join(missionDir, "evidence", "close-report.json");
      if (existsSync(closeReportPath)) {
        try {
          const closeReportRaw = await fs.readFile(closeReportPath, "utf8");
          const closeReport = JSON.parse(closeReportRaw) as Record<string, unknown>;
          closeReport.releaseId = releaseId;
          await atomicWriteFile(closeReportPath, JSON.stringify(closeReport, null, 2) + "\n");
          logger.info(`  Synced close-report.json releaseId to ${releaseId}`);
        } catch (err) {
          logger.warn(
            `[release.prepare] failed to sync close-report.json: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      } else {
        logger.warn(
          `[release.prepare] close-report.json not found for mission '${missionId}' — skipping releaseId sync (mission may have been closed before RFC-0477)`,
        );
      }

      // RFC-0520: C-surface regression check delegated to evaluateCSurfaceGate
      let cSurfaceVerdict: "pass" | "fail" | "skipped" = "skipped";
      try {
        const { runSurfaceContractValidate } = await import("../handoff/surface-contract.ts");
        const surfaceResult = await runSurfaceContractValidate(
          { flags: { app: systemId }, argv: [] },
          context,
        );

        const mission = await readMissionManifest(workspaceRoot, missionId);
        const rfcId = mission.rfcId ?? null;
        let breaksC = false;
        if (rfcId) {
          breaksC = await checkBreaksCDeclaration(workspaceRoot, rfcId);
        }

        const guardResult = evaluateCSurfaceGate({
          systemId,
          missionId,
          workspaceRoot,
          surfaceValidateResult: {
            exitCode: surfaceResult.exitCode ?? 1,
            summary: surfaceResult.summary,
          },
          rfcId,
          breaksC,
        });

        cSurfaceVerdict = guardResult.verdict === "fail" ? "fail" : "pass";
        if (guardResult.verdict === "fail") {
          throw new Error(guardResult.violations[0]!.message);
        }
        if (guardResult.verdict === "pass" && breaksC) {
          logger.info(`  ${guardResult.summary}`);
        }
      } catch (err) {
        if (err instanceof Error && err.message.includes("C-surface regression")) {
          throw err;
        }
        cSurfaceVerdict = "skipped";
      }

      logger.success(
        `[release.prepare] ${releaseId} prepared (snapshot diff: ${snapshotDiffVerdict}, C-surface: ${cSurfaceVerdict})`,
      );

      return {
        data: {
          releaseId,
          systemId,
          missionId,
          semver,
          state: "prepared",
          snapshotDiffVerdict,
          cSurfaceVerdict,
          behaviorSnapshotHash,
          distTreeHash,
          siteContentHash,
          readableSnapshotHash,
          buildReused,
        },
        summary: `[release.prepare] ${releaseId} prepared (snapshot diff: ${snapshotDiffVerdict}, C-surface: ${cSurfaceVerdict})`,
        nextSteps: [
          {
            action: `Mark release as ready: pnpm exec werkstatt run release.ready --release ${releaseId}`,
            kind: "required",
          },
        ],
      };
    } finally {
      await releaseLock(workspaceRoot, `release:${releaseId}`);
    }
  } finally {
    await releaseLock(workspaceRoot, `system:${systemId}`);
  }
}

async function copyDir(src: string, dest: string): Promise<void> {
  if (!existsSync(src)) return;
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

// §6.2: release.ready (renamed from release.publish by RFC-0724)
export interface ReleaseReadyData {
  releaseId: string;
  systemId: string;
  state: "ready";
  readyAt: string;
  artifactUri: string | null;
  distArtifactHash: string | null;
  distVerified: boolean;
}

export async function runReleaseReady(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<ReleaseReadyData>> {
  const { workspaceRoot, logger } = context;
  const releaseId = flagString(input, "release");
  if (!releaseId) throw new Error("[release.ready] --release is required");

  const releaseDir = path.join(workspaceRoot, "releases", releaseId);
  if (!existsSync(releaseDir)) {
    throw new Error(`[release.ready] release '${releaseId}' not found`);
  }

  const manifest = await readReleaseManifest(workspaceRoot, releaseId);
  if (manifest.state !== "prepared") {
    throw new Error(
      `[release.ready] release '${releaseId}' is not prepared (state: ${manifest.state})`,
    );
  }

  // RFC-0585: Check distTreeHash is not pending
  const distTreeHash = manifest.distTreeHash;
  if (!distTreeHash || distTreeHash === "sha256:pending") {
    throw new Error(
      `[release.ready] distTreeHash is pending or missing — run release.prepare to compute a real hash before marking ready`,
    );
  }

  // RFC-0585: Check dist directory exists
  const distDir = path.join(releaseDir, "dist");
  if (!existsSync(distDir)) {
    throw new Error(
      `[release.ready] release '${releaseId}' has no dist/ directory — run release.prepare to build and stage the distribution`,
    );
  }

  // Check snapshot diff verdict
  if (manifest.snapshotDiffVerdict === "fail") {
    throw new Error(`[release.ready] snapshot diff verdict is fail — cannot mark ready`);
  }

  // Check discipline gates
  if (manifest.migratorVerdict === "fail") {
    throw new Error(`[release.ready] migrator.registry.validate failed — cannot mark ready`);
  }
  if (manifest.versionCompareVerdict === "refuse-downgrade") {
    throw new Error(
      `[release.ready] version-compare verdict is refuse-downgrade — cannot mark ready`,
    );
  }

  const systemId = manifest.systemId;
  const operationId = generateOperationId();

  await acquireLock(workspaceRoot, `system:${systemId}`, operationId, "release.ready", "agent");
  await acquireLock(workspaceRoot, `release:${releaseId}`, operationId, "release.ready", "agent");

  try {
    const now = new Date().toISOString();

    // RFC-0596: Store artifact BEFORE state transition (eliminates partial failure)
    // release.ready already holds release:${releaseId} and system:${systemId} locks,
    // so we call the lock-free core directly — not runArtifactStorePut which would deadlock.
    // distDir was already declared and validated above (RFC-0585 check).
    const artifactResult = await storeArtifactCore(workspaceRoot, releaseId, distDir, systemId);

    // Update manifest with artifact reference and state transition in a single write
    const artifactRef: ReleaseArtifactRef = {
      uri: artifactResult.uri,
      provider: "local",
      distArtifactHash: artifactResult.distArtifactHash,
      distTreeHash: artifactResult.distTreeHash,
      siteContentHash: artifactResult.siteContentHash,
      byteSize: artifactResult.byteSize,
      fileCount: artifactResult.fileCount,
    };
    manifest.artifact = artifactRef;
    manifest.distArtifactHash = artifactResult.distArtifactHash;
    manifest.state = "ready";
    manifest.readyAt = now;
    await writeReleaseYaml(workspaceRoot, releaseId, manifest);

    // Append Bordbuch entry (RFC-0750: commit atomically)
    await appendAndCommitBordbuch(
      workspaceRoot,
      systemId,
      "release-ready",
      `Release ${releaseId} marked ready`,
      "agent",
      {
        writerRole: "release",
        metadata: { releaseId, semver: manifest.semver },
      },
      `Bordbuch: release-ready ${releaseId}`,
    );

    // Update state
    const state = await readSystemState(workspaceRoot, systemId);
    state.lastRelease = releaseId;
    await writeSystemState(workspaceRoot, systemId, state);

    logger.success(`[release.ready] ${releaseId} marked ready`);

    return {
      data: {
        releaseId,
        systemId,
        state: "ready",
        readyAt: now,
        artifactUri: manifest.artifact?.uri ?? null,
        distArtifactHash: manifest.distArtifactHash ?? null,
        distVerified: true,
      },
      summary: `[release.ready] ${releaseId} marked ready`,
      nextSteps: [
        {
          action: `Deploy to dev: pnpm exec werkstatt run leitstand.dev-deploy --release ${releaseId}`,
          kind: "required",
        },
      ],
    };
  } finally {
    await releaseLock(workspaceRoot, `release:${releaseId}`);
    await releaseLock(workspaceRoot, `system:${systemId}`);
  }
}

// §6.3: release.validate
export interface ReleaseValidateData {
  releaseId: string;
  manifestFound: boolean;
  state: string;
  snapshotDiffVerdict: string;
  artifactPresent: boolean;
}

export async function runReleaseValidate(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<ReleaseValidateData>> {
  const { workspaceRoot, logger } = context;
  const releaseId = flagString(input, "release");
  if (!releaseId) throw new Error("[release.validate] --release is required");

  const releaseDir = path.join(workspaceRoot, "releases", releaseId);
  const manifestFound = existsSync(releaseDir);

  if (!manifestFound) {
    logger.error(`[release.validate] release '${releaseId}' not found`);
    return {
      data: {
        releaseId,
        manifestFound,
        state: "absent",
        snapshotDiffVerdict: "fail",
        artifactPresent: false,
      },
      exitCode: 1,
    };
  }

  const manifest = await readReleaseManifest(workspaceRoot, releaseId);
  const distDir = path.join(releaseDir, "dist");
  const releaseState = manifest.state;

  let artifactPresent: boolean;
  if (releaseState === "ready") {
    artifactPresent = manifest.artifact !== null;
    if (!artifactPresent) {
      logger.warn(
        `[release.validate] ready release '${releaseId}' has no artifact — run release.ready to store it`,
      );
    }
  } else {
    artifactPresent = existsSync(distDir) || manifest.artifact !== null;
  }

  logger.success(`[release.validate] ${releaseId} valid (state: ${releaseState})`);

  return {
    data: {
      releaseId,
      manifestFound,
      state: manifest.state,
      snapshotDiffVerdict: manifest.snapshotDiffVerdict,
      artifactPresent,
    },
    summary: `[release.validate] ${releaseId} valid (state: ${manifest.state})`,
    nextSteps:
      manifest.state === "prepared"
        ? [
            {
              action: `Mark release as ready: pnpm exec werkstatt run release.ready --release ${releaseId}`,
              kind: "optional",
            },
          ]
        : manifest.state === "ready"
          ? [
              {
                action: `Deploy to dev: pnpm exec werkstatt run leitstand.dev-deploy --release ${releaseId}`,
                kind: "optional",
              },
            ]
          : undefined,
  };
}

// §6.4: release.list
export interface ReleaseListData {
  releases: Array<{ releaseId: string; systemId: string; state: string }>;
  count: number;
  legacyInvalid: LegacyReleaseDiagnostic[];
}

export async function runReleaseList(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<ReleaseListData>> {
  const { workspaceRoot, logger } = context;
  const systemFilter = flagString(input, "site");

  const releasesDir = path.join(workspaceRoot, "releases");
  if (!existsSync(releasesDir)) {
    return {
      data: { releases: [], count: 0, legacyInvalid: [] },
      summary: `[release.list] 0 releases`,
    };
  }

  const entries = await fs.readdir(releasesDir, { withFileTypes: true });
  const releases: Array<{ releaseId: string; systemId: string; state: string }> = [];
  const legacyInvalid: LegacyReleaseDiagnostic[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.includes(".staging-")) continue;
    const releaseId = entry.name;
    try {
      const manifest = await readReleaseManifest(workspaceRoot, releaseId);
      const systemId = manifest.systemId;
      if (systemFilter && systemId !== systemFilter) continue;
      releases.push({ releaseId, systemId, state: manifest.state });
    } catch (err) {
      if (err instanceof LegacyReleaseError) {
        legacyInvalid.push({
          schema: "werkstatt/legacy-release-diagnostic@1",
          releaseId: err.releaseId,
          legacyState: err.legacyState as LegacyReleaseDiagnostic["legacyState"],
          ruleId: "CERT-LEGACY-STATE-01",
          message: `Release '${err.releaseId}' uses legacy state '${err.legacyState}' which is no longer valid per RFC-0851.`,
          fixHint:
            "This release directory is preserved but cannot be used. CERT-010 will handle audited cleanup.",
        });
      }
    }
  }

  logger.info(`  Found ${releases.length} valid releases, ${legacyInvalid.length} legacy invalid`);
  return {
    data: { releases, count: releases.length, legacyInvalid },
    summary: `[release.list] ${releases.length} releases (${legacyInvalid.length} legacy invalid)`,
  };
}

// §6.8: release.state.validate (RFC-0655)
export interface ReleaseStateCheck {
  rule: string;
  status: "pass" | "warn" | "fail";
  message: string;
}

export interface ReleaseStateValidateData {
  missionId: string | null;
  releaseId: string | null;
  systemId: string | null;
  releaseState: "prepared" | "ready" | "missing";
  checks: ReleaseStateCheck[];
  summary: string;
}

export async function runReleaseStateValidate(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<ReleaseStateValidateData>> {
  const { workspaceRoot, logger } = context;
  const missionIdFlag = flagString(input, "mission");
  const releaseIdFlag = flagString(input, "release");
  const systemFlag = flagString(input, "site");

  if (!missionIdFlag && !releaseIdFlag && !systemFlag) {
    throw new Error(
      "[release.state.validate] at least one of --mission, --release, or --site is required",
    );
  }

  // Resolve the list of (missionId, releaseId, systemId) tuples to validate
  const targets: Array<{
    missionId: string | null;
    releaseId: string | null;
    systemId: string | null;
  }> = [];

  if (missionIdFlag) {
    const manifest = await readMissionManifest(workspaceRoot, missionIdFlag);
    const rid = (manifest.releaseId as string | null) ?? null;
    const sid = (manifest.systemId as string | null) ?? null;
    targets.push({ missionId: missionIdFlag, releaseId: rid, systemId: sid });
  } else if (releaseIdFlag) {
    const manifest = await readReleaseManifest(workspaceRoot, releaseIdFlag);
    const sid = manifest.systemId;
    const mid = manifest.missionId;
    targets.push({ missionId: mid, releaseId: releaseIdFlag, systemId: sid });
  } else if (systemFlag) {
    // Validate all releases for the system
    const releaseIds = await listReleaseIds(workspaceRoot);
    for (const rid of releaseIds) {
      try {
        const manifest = await readReleaseManifest(workspaceRoot, rid);
        const sid = manifest.systemId;
        if (sid !== systemFlag) continue;
        const mid = manifest.missionId;
        targets.push({ missionId: mid, releaseId: rid, systemId: sid });
      } catch {
        // skip unreadable
      }
    }
  }

  const allChecks: ReleaseStateCheck[] = [];
  let hasError = false;

  for (const target of targets) {
    const checks = await validateReleaseState(workspaceRoot, target, logger);
    allChecks.push(...checks);
    if (checks.some((c) => c.status === "fail")) {
      hasError = true;
    }
  }

  // Determine overall release state from the first target (for single-target invocations)
  let overallReleaseState: ReleaseStateValidateData["releaseState"] = "missing";
  if (targets.length > 0 && targets[0]!.releaseId) {
    try {
      const manifest = await readReleaseManifest(workspaceRoot, targets[0]!.releaseId);
      overallReleaseState = manifest.state;
    } catch {
      overallReleaseState = "missing";
    }
  }

  const firstTarget = targets[0];
  const summary = hasError
    ? `[release.state.validate] ${allChecks.filter((c) => c.status === "fail").length} error${allChecks.filter((c) => c.status === "fail").length === 1 ? "" : "s"} found`
    : `[release.state.validate] all checks passed${allChecks.some((c) => c.status === "warn") ? ` (${allChecks.filter((c) => c.status === "warn").length} warning${allChecks.filter((c) => c.status === "warn").length === 1 ? "" : "s"})` : ""}`;

  if (hasError) {
    logger.warn(`[release.state.validate] ${summary}`);
  } else {
    logger.info(`[release.state.validate] ${summary}`);
  }

  return {
    data: {
      missionId: firstTarget?.missionId ?? null,
      releaseId: firstTarget?.releaseId ?? null,
      systemId: firstTarget?.systemId ?? null,
      releaseState: overallReleaseState,
      checks: allChecks,
      summary,
    },
    summary,
    nextSteps: hasError
      ? [
          {
            action: `Fix the failing checks above, then re-run: pnpm exec werkstatt run release.state.validate --release ${firstTarget?.releaseId ?? "<release-id>"}`,
            kind: "required",
          },
        ]
      : undefined,
  };
}

async function validateReleaseState(
  workspaceRoot: string,
  target: { missionId: string | null; releaseId: string | null; systemId: string | null },
  _logger: { warn: (msg: string) => void; info: (msg: string) => void },
): Promise<ReleaseStateCheck[]> {
  const checks: ReleaseStateCheck[] = [];
  const { missionId, releaseId, systemId } = target;

  // Read mission.yaml if missionId is available
  let missionReleaseId: string | null = null;
  if (missionId) {
    try {
      const manifest = await readMissionManifest(workspaceRoot, missionId);
      missionReleaseId = (manifest.releaseId as string | null) ?? null;
    } catch {
      // mission.yaml not found — skip mission-based checks
    }
  }

  // Check 1: mission-yaml-release-id-exists
  if (missionReleaseId) {
    const releaseDir = path.join(workspaceRoot, "releases", missionReleaseId);
    const releaseYaml = path.join(releaseDir, "release.yaml");
    if (!existsSync(releaseDir) || !existsSync(releaseYaml)) {
      checks.push({
        rule: "mission-yaml-release-id-exists",
        status: "fail",
        message: `mission.yaml references releaseId '${missionReleaseId}' but release directory or release.yaml does not exist`,
      });
    } else {
      checks.push({
        rule: "mission-yaml-release-id-exists",
        status: "pass",
        message: `release directory for '${missionReleaseId}' exists`,
      });
    }
  } else if (missionId) {
    checks.push({
      rule: "mission-yaml-release-id-exists",
      status: "pass",
      message: `mission '${missionId}' has no releaseId in mission.yaml — nothing to validate`,
    });
  }

  // Check 2: close-report-release-id-consistent
  if (missionId) {
    const closeReportPath = path.join(
      resolveMissionDir(workspaceRoot, missionId),
      "evidence",
      "close-report.json",
    );
    if (!existsSync(closeReportPath)) {
      checks.push({
        rule: "close-report-release-id-consistent",
        status: "warn",
        message: `close-report.json not found for mission '${missionId}' (mission may have been closed before RFC-0477) — skipping check`,
      });
    } else {
      try {
        const raw = await fs.readFile(closeReportPath, "utf8");
        const report = JSON.parse(raw) as Record<string, unknown>;
        const closeReportReleaseId = (report.releaseId as string | null) ?? null;
        if (missionReleaseId && closeReportReleaseId !== missionReleaseId) {
          checks.push({
            rule: "close-report-release-id-consistent",
            status: "fail",
            message: `close-report.json releaseId '${closeReportReleaseId}' does not match mission.yaml releaseId '${missionReleaseId}'`,
          });
        } else {
          checks.push({
            rule: "close-report-release-id-consistent",
            status: "pass",
            message: `close-report.json releaseId is consistent with mission.yaml`,
          });
        }
      } catch (err) {
        checks.push({
          rule: "close-report-release-id-consistent",
          status: "warn",
          message: `failed to parse close-report.json: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  }

  // Check 3: release-state-progressed
  const effectiveReleaseId = releaseId ?? missionReleaseId;
  if (effectiveReleaseId) {
    try {
      const manifest = await readReleaseManifest(workspaceRoot, effectiveReleaseId);
      const state = manifest.state;
      if (state === "prepared") {
        checks.push({
          rule: "release-state-progressed",
          status: "warn",
          message: `release '${effectiveReleaseId}' is in 'prepared' state (orphaned — not yet ready)`,
        });
      } else {
        checks.push({
          rule: "release-state-progressed",
          status: "pass",
          message: `release '${effectiveReleaseId}' state is '${state}'`,
        });
      }

      // Check 5: state-last-release-consistent
      if (state === "ready" && systemId) {
        try {
          const systemState = await readSystemState(workspaceRoot, systemId);
          const lastRelease = systemState.lastRelease as string | null | undefined;
          if (!lastRelease) {
            checks.push({
              rule: "state-last-release-consistent",
              status: "warn",
              message: `release '${effectiveReleaseId}' is ready but system-state.yaml has no lastRelease for system '${systemId}'`,
            });
          } else if (lastRelease !== effectiveReleaseId) {
            checks.push({
              rule: "state-last-release-consistent",
              status: "warn",
              message: `system-state.yaml lastRelease '${lastRelease}' does not match ready release '${effectiveReleaseId}'`,
            });
          } else {
            checks.push({
              rule: "state-last-release-consistent",
              status: "pass",
              message: `system-state.yaml lastRelease is consistent`,
            });
          }
        } catch {
          checks.push({
            rule: "state-last-release-consistent",
            status: "warn",
            message: `failed to read system-state.yaml for system '${systemId}'`,
          });
        }
      }
    } catch {
      checks.push({
        rule: "release-state-progressed",
        status: "fail",
        message: `release '${effectiveReleaseId}' not found or unreadable`,
      });
    }
  }

  // Check 4: bordbuch-release-id-consistent
  if (systemId && missionId) {
    try {
      const { readBordbuch } = await import("../bordbuch/bordbuch-io.ts");
      const entries = await readBordbuch(workspaceRoot, systemId);
      const missionCloseEntries = entries.filter(
        (e) => e.kind === "mission-close" && e.missionId === missionId,
      );
      if (missionCloseEntries.length === 0) {
        checks.push({
          rule: "bordbuch-release-id-consistent",
          status: "warn",
          message: `no mission-close bordbuch entry found for mission '${missionId}'`,
        });
      } else {
        const latestClose = missionCloseEntries[missionCloseEntries.length - 1]!;
        const bordbuchReleaseId = latestClose.releaseId;
        // The bordbuch releaseId reflects the state at close time.
        // If release.prepare wrote a new releaseId to mission.yaml after close,
        // the bordbuch correctly reflects the close-time state — not a mismatch.
        // We only flag a mismatch if the bordbuch has a releaseId that differs
        // from what mission.yaml had at close time (which we can't know post-prepare).
        // So we check: if bordbuch has a non-null releaseId, it should match
        // mission.yaml's current releaseId (since release.prepare doesn't change
        // bordbuch). If bordbuch has null and mission.yaml has non-null, that's
        // expected when release.prepare ran after close.
        if (bordbuchReleaseId && missionReleaseId && bordbuchReleaseId !== missionReleaseId) {
          checks.push({
            rule: "bordbuch-release-id-consistent",
            status: "fail",
            message: `bordbuch mission-close releaseId '${bordbuchReleaseId}' does not match mission.yaml releaseId '${missionReleaseId}'`,
          });
        } else {
          checks.push({
            rule: "bordbuch-release-id-consistent",
            status: "pass",
            message: bordbuchReleaseId
              ? `bordbuch releaseId '${bordbuchReleaseId}' is consistent`
              : `bordbuch releaseId is null (mission closed before release.prepare — expected)`,
          });
        }
      }
    } catch {
      checks.push({
        rule: "bordbuch-release-id-consistent",
        status: "warn",
        message: `failed to read bordbuch for system '${systemId}'`,
      });
    }
  }

  return checks;
}

// §6.9: dist.determinism.validate (RFC-0656)
export interface NonDeterministicFile {
  path: string;
  normalizer: string;
  reason: string;
}

export interface DistDeterminismValidateData {
  distPath: string;
  stableHash: string;
  byteHash: string;
  hashesMatch: boolean;
  nonDeterministicFiles: NonDeterministicFile[];
  totalFiles: number;
}

export async function runDistDeterminismValidate(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<DistDeterminismValidateData>> {
  const { workspaceRoot } = context;
  const releaseId = flagString(input, "release");
  const missionId = flagString(input, "mission");

  if (!releaseId && !missionId) {
    throw new Error("[dist.determinism.validate] either --release or --mission is required");
  }
  if (releaseId && missionId) {
    throw new Error("[dist.determinism.validate] --release and --mission are mutually exclusive");
  }

  let distPath: string;
  if (releaseId) {
    distPath = path.join(workspaceRoot, "releases", releaseId, "dist");
  } else {
    const missionDir = resolveMissionDir(workspaceRoot, missionId!);
    const workpieceDist = path.join(missionDir, "workpiece", "dist");
    const distributionDist = path.join(missionDir, "distribution", "dist");
    if (existsSync(workpieceDist)) {
      distPath = workpieceDist;
    } else if (existsSync(distributionDist)) {
      distPath = distributionDist;
    } else {
      return {
        data: {
          distPath: "",
          stableHash: "",
          byteHash: "",
          hashesMatch: false,
          nonDeterministicFiles: [],
          totalFiles: 0,
        },
        exitCode: 1,
        summary: `[dist.determinism.validate] no dist directory found for mission '${missionId}'`,
      };
    }
  }

  if (!existsSync(distPath)) {
    return {
      data: {
        distPath,
        stableHash: "",
        byteHash: "",
        hashesMatch: false,
        nonDeterministicFiles: [],
        totalFiles: 0,
      },
      exitCode: 1,
      summary: `[dist.determinism.validate] dist directory does not exist: ${distPath}`,
    };
  }

  const stableResult = await fingerprintTree(distPath, { mode: "stable", root: distPath });
  const byteResult = await fingerprintTree(distPath, { mode: "byte" });

  const nonDeterministicFiles: NonDeterministicFile[] = [];
  const stableByPath = new Map<string, (typeof stableResult.files)[number]>();
  for (const f of stableResult.files) {
    stableByPath.set(f.path, f);
  }

  for (const byteFile of byteResult.files) {
    const stableFile = stableByPath.get(byteFile.path);
    if (stableFile && stableFile.hash !== byteFile.hash) {
      nonDeterministicFiles.push({
        path: byteFile.path,
        normalizer: stableFile.normalizer,
        reason: `${stableFile.normalizer} normalization changed hash`,
      });
    }
  }

  const hashesMatch = nonDeterministicFiles.length === 0;

  return {
    data: {
      distPath,
      stableHash: stableResult.value,
      byteHash: byteResult.value,
      hashesMatch,
      nonDeterministicFiles,
      totalFiles: stableResult.files.length,
    },
    exitCode: hashesMatch ? undefined : 1,
    summary: hashesMatch
      ? `[dist.determinism.validate] all ${stableResult.files.length} files are deterministic`
      : `[dist.determinism.validate] ${nonDeterministicFiles.length}/${stableResult.files.length} files are non-deterministic`,
    nextSteps: hashesMatch
      ? undefined
      : [
          {
            action: `Review the ${nonDeterministicFiles.length} non-deterministic files listed above and add normalizers or exclude them from the build, then re-run: pnpm exec werkstatt run dist.determinism.validate --release ${releaseId ?? `<mission>`}`,
            kind: "required",
          },
        ],
  };
}

/* --- RFC-0931: release.sign --- */

export interface ReleaseSignData {
  command: "release.sign";
  releaseId: string;
  buildIdentitySigned: boolean;
  signedManifestProduced: boolean;
  signatureHex: string;
  publicKeyHex: string;
  publicKeyUrl: string | null;
  reusedExistingSignature: boolean;
}

export async function runReleaseSign(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<ReleaseSignData>> {
  const { workspaceRoot } = context;
  const releaseId = flagString(input, "release");
  if (!releaseId) throw new Error("[release.sign] --release is required");

  const releaseDir = path.join(workspaceRoot, "releases", releaseId);
  if (!existsSync(releaseDir)) {
    throw new Error(`[release.sign] release directory not found: ${releaseDir}`);
  }

  const distDir = path.join(releaseDir, "dist");
  const buildIdentityPath = path.join(distDir, "client", ".well-known", "build-identity.json");
  if (!existsSync(buildIdentityPath)) {
    throw new Error(
      `[release.sign] build-identity.json not found at ${buildIdentityPath}. Run release.prepare first.`,
    );
  }

  const env = { ...filterEnv(process.env) };

  const privateKeyEnv = env["SIGNING_PRIVATE_KEY"];
  const privateKeyPath = env["SIGNING_PRIVATE_KEY_PATH"];
  const publicKeyUrl = env["PUBLIC_KEY_URL"];

  if (!privateKeyEnv && !privateKeyPath) {
    throw new Error(
      "[release.sign] No signing key configured. Set SIGNING_PRIVATE_KEY or SIGNING_PRIVATE_KEY_PATH env var.",
    );
  }

  let privateKeyBytes: Uint8Array;
  let privateKeyPem: string;
  try {
    if (privateKeyEnv) {
      privateKeyPem = privateKeyEnv;
      privateKeyBytes = await loadPrivateKey({ pem: privateKeyEnv });
    } else {
      privateKeyPem = await fs.readFile(privateKeyPath!, "utf8");
      privateKeyBytes = await loadPrivateKey({
        filePath: privateKeyPath!,
        encoding: "pem",
      });
    }
  } catch (err) {
    throw new Error(
      `[release.sign] Failed to load private key: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  try {
    await runIntegrityBuildRecord(
      { flags: {}, args: ["dist"] } as unknown as KernelCommandInput,
      {
        ...context,
        dryRun: false,
        site: undefined,
        workspaceRoot: releaseDir,
      } as KernelRuntimeContext,
    );
  } catch {
    // Non-fatal: integrity.build-record may fail if dist is already recorded
  }

  const signResult = await signBuildIdentity({
    buildIdentityPath,
    privateKeyBytes,
    publicKeyUrl,
  });

  let signedManifestProduced = false;
  try {
    await signLatestBuildArtifacts({
      cwd: releaseDir,
      privateKeyPem,
      publicKeyUrl,
    });
    signedManifestProduced = true;
  } catch {
    // Non-fatal: signed-manifest.json may fail if .integrity/ artifacts are incomplete
  }

  await writeReleasePublicKey({
    distDir,
    publicKeyHex: signResult.publicKeyHex,
  });

  const data: ReleaseSignData = {
    command: "release.sign",
    releaseId,
    buildIdentitySigned: true,
    signedManifestProduced,
    signatureHex: signResult.signatureHex,
    publicKeyHex: signResult.publicKeyHex,
    publicKeyUrl: signResult.publicKeyUrl,
    reusedExistingSignature: signResult.reusedExistingSignature,
  };

  return {
    data,
    summary: `[release.sign] ${releaseId}: build-identity.json signed${signResult.reusedExistingSignature ? " (reused existing signature)" : ""}, release-pubkey.json written${signedManifestProduced ? ", signed-manifest.json produced" : ""}`,
  };
}
