/*
<MODULE_CONTRACT>
<purpose>RFC-0356 §1: mission.materialize — populate Werkstück from pinned Sternsystem bundle.</purpose>
<non-goals>
  <item>Does not define mission lifecycle — that is RFC-0355.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0356: initial mission.materialize command handler.</item>
  <item>RFC-0389: replace minimal inline stubs with full boilerplate generation using @warpgogol/site-kernel-codegen generators and @warpgogol/site-kernel-onboarding templates.</item>
  <item>RFC-0388: generate .env.example via env.example.generate and copy to .env (DNA-40 env-and-deploy contract).</item>
  <item>RFC-0480: add paused status guard; init git in workpiece and commit materialized state.</item>
  <item>RFC-0517: add preflight content quality gate between atomicMoveDir and git init.</item>
  <item>Run build.prepare pipeline after atomicMoveDir to generate all derived artifacts (surface, sitemap, video/image variants, etc.) before git init.</item>
  <item>Set PUBLIC_IMAGE_PROVIDER=build-portable in workpiece .env files so image.variants.generate produces responsive variants.</item>
  <item>RFC-0647: replace inline ensurePlaywrightChromium with ensureChromium from @warpgogol/site-kernel-checks (launch verification + PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD support).</item>
  <item>RFC-0568: replace git init with git clone from cache clone; stage only data paths in materialize commit (DNA-44 compliance).</item>
  <item>Run pnpm install after atomicMoveDir to link workpiece workspace deps before build.prepare (fixes workpiece.imports.validate failure on fresh workpiece).</item>
  <item>RFC-0580: auto-commit werkstatt side-effects (mission.yaml, pnpm-lock.yaml) after writeMissionManifest.</item>
  <item>RFC-0597: skip preflight on unchanged cache clone HEAD, run build.prepare.dev instead of build.prepare, warm .cache/video/ and .cache/video-live/ from cache clone.</item>
  <item>RFC-0620: replace hardcoded bordbuch file removal with ownership-map-driven filter that excludes all workspace-absolute generated files from STERNSYSTEM_DATA_PATHS copy.</item>
  <item>RFC-0659: add workpiece artifact cache — skip codegen on repeated materialization when cache key (cacheCloneHead + platformVersion + platformSemanticHash) matches.</item>
  <item>Preserve operator-filled .env from old workpiece before atomicMoveDir and restore after — prevents secret loss (CLOUDFLARE_API_TOKEN, R2 keys) on re-materialization.</item>
  <item>RFC-0796: add checkWorkspaceGlobsForStalePackages pre-flight guard before pnpm install — detects stale package.json workspace references to missing packages.</item>
  <item>RFC-0822: replace old-workpiece .env preservation with restoreEnvFilesFromCacheClone — cache clone is the canonical inter-mission store for secrets.</item>
  <item>RFC-0870: restore registry-only generated files from git after atomicMoveDir — prevents silent loss of committed manifests when staging dir lacks them.</item>
  <item>Hardcode production domain in SITE_LINE — remove PUBLIC_SITE_URL override that allowed .env to bake dev domain into build artifacts.</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { glob as fsGlob } from "node:fs/promises";
import path from "node:path";
import { execSync } from "node:child_process";
import { parse as yamlParse } from "yaml";
import type {
  DiscoveredSiteWorkspace,
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import {
  runKernelWire,
  executeKernelCommand,
  executeKernelPipeline,
} from "@warpgogol/werkstatt-engine/kernel";
import {
  readSystemConfig,
  resolveCacheClonePath,
  resolveMirrors,
  resolveMirrorPath,
} from "../sternsystem/registry-io.ts";
import { installBordbuchPreCommitHook } from "../bordbuch/bordbuch-hook.ts";
import { readMissionManifest, writeMissionManifest, resolveMissionDir } from "./mission-io.ts";
import type { MissionManifest } from "@warpgogol/werkstatt-engine/schemas";
import { restoreEnvFilesFromCacheClone } from "./env-persist.ts";
import { restoreOperatorConfigFiles } from "./operator-config-files.ts";
import { acquireLock, releaseLock, commitWerkstattSideEffects } from "../werkstatt/index.ts";
import { atomicMoveDir, atomicWriteFile, resolveStagingDir } from "../werkstatt/atomic.ts";
import { appendAndCommitBordbuch } from "../bordbuch/bordbuch-commit-helper.ts";
import { installWorkpieceCommitHook } from "./workpiece-commit-hook.ts";
import { resolveCurrentEcosystem, resolvePlatformSemanticHash } from "../handoff/bundle-io.ts";
import { byteHash } from "@warpgogol/werkstatt-engine/fingerprint";
import { compareSemver } from "@warpgogol/werkstatt-engine/kernel";
import type { KernelPipelineStep } from "@warpgogol/werkstatt-engine/kernel";

export interface MissionMaterializeData {
  missionId: string;
  systemId: string;
  versionComparison: {
    verdict: "in-sync" | "catch-up" | "refuse-downgrade";
    pinVersion: string;
    platformVersion: string;
    packagesDrift: boolean;
    message: string;
  };
  migratorChain: Array<{ fromVersion: string; toVersion: string; rfc: string; applied: boolean }>;
  capabilityDiff: { tier: "green" | "yellow" | "red"; items: Array<Record<string, unknown>> };
  regeneration: { regeneratedFiles: string[]; success: boolean };
  materializedAt: string;
  preflightSkipped: boolean;
  preflightSkipReason: string | null;
  pipelineUsed: string;
  mediaCacheWarmed: boolean;
  mediaCacheSources: number;
  bordbuchHookInstalled: boolean;
  artifactCacheHit: boolean;
  artifactCacheKey: string | null;
  artifactCacheSkipped: boolean;
  workspaceGlobCheck: { stalePackages: string[]; ok: boolean };
}

// RFC-0796: Pre-flight guard — check workspace globs for stale package.json references.
// Detects workspace:* dependencies pointing to packages that no longer exist
// (e.g. archived mission workpiece directories). Aborts before pnpm install
// to prevent cryptic resolution failures.
export async function checkWorkspaceGlobsForStalePackages(
  workspaceRoot: string,
): Promise<{ stalePackages: string[]; ok: boolean }> {
  const workspaceYamlPath = path.join(workspaceRoot, "pnpm-workspace.yaml");
  if (!existsSync(workspaceYamlPath)) {
    return { stalePackages: [], ok: true };
  }

  const content = readFileSync(workspaceYamlPath, "utf8");
  const workspace = yamlParse(content);
  const patterns: string[] = workspace.packages ?? [];

  // Collect all package.json files matching workspace globs
  const packageJsonPaths: string[] = [];
  for (const pattern of patterns) {
    // Skip negation patterns
    if (pattern.startsWith("!")) continue;
    const globPattern = path.join(workspaceRoot, pattern, "package.json");
    try {
      for await (const match of fsGlob(globPattern)) {
        packageJsonPaths.push(match);
      }
    } catch {
      // Glob pattern may not match — skip
    }
  }

  // Build set of all package names in the workspace
  const workspacePackageNames = new Set<string>();
  for (const pkgJsonPath of packageJsonPaths) {
    try {
      const pkgContent = readFileSync(pkgJsonPath, "utf8");
      const pkg = JSON.parse(pkgContent);
      if (pkg.name) {
        workspacePackageNames.add(pkg.name);
      }
    } catch {
      // Can't read package.json — skip
    }
  }

  // Check each package.json for workspace:* references to missing packages
  const stalePackages: string[] = [];
  for (const pkgJsonPath of packageJsonPaths) {
    try {
      const pkgContent = readFileSync(pkgJsonPath, "utf8");
      const pkg = JSON.parse(pkgContent);
      const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
      for (const [depName, depSpec] of Object.entries(deps)) {
        if (typeof depSpec === "string" && depSpec.startsWith("workspace:")) {
          if (!workspacePackageNames.has(depName)) {
            const relPath = path.relative(workspaceRoot, pkgJsonPath);
            stalePackages.push(`${relPath} → ${depName} (${depSpec})`);
          }
        }
      }
    } catch {
      // Can't read package.json — skip
    }
  }

  return { stalePackages, ok: stalePackages.length === 0 };
}
interface MaterializationCacheState {
  systemId: string;
  cacheKey: string;
  cacheCloneHead: string;
  platformVersion: string;
  platformSemanticHash: string;
  writtenAt: string;
}

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

function flagBool(input: KernelCommandInput, key: string): boolean {
  const v = input.flags[key];
  return v === true || v === "true";
}

const STERNSYSTEM_DATA_PATHS = [
  "src/content",
  "public",
  "provenance",
  "behavior.snapshot.generated.yaml",
  "system-config.yaml",
  "system-state.yaml",
];

// RFC-0597: Materialization state file interface
interface MaterializationState {
  systemId: string;
  cacheCloneHead: string;
  lastValidatedAt: string;
  lastMissionId: string;
}

// RFC-0597: Media cache directories to persist across missions
const MEDIA_CACHE_DIRS = [".cache/video", ".cache/video-live"];

/**
 * RFC-0620: Collect workspace-absolute generated paths from GENERATOR_OWNERSHIP_MAP.
 * These are entries whose path starts with `systems/{system}/` — they represent
 * generated artifacts written to the cache clone (e.g. bordbuch projections), not
 * authored content. They must be excluded from the data-path copy to avoid
 * ownership.sync.validate OWN-01 failures in the workpiece context.
 *
 * The ownership map uses `{system}` as a template placeholder. This function
 * returns paths relative to the cache clone root (e.g. `public/.well-known/bordbuch.json`).
 */
async function getWorkspaceAbsoluteGeneratedPaths(): Promise<Set<string>> {
  const { GENERATOR_OWNERSHIP_MAP } = await import("@warpgogol/werkstatt-site/checks");
  const prefix = "systems/{system}/";
  const paths = new Set<string>();
  for (const entry of GENERATOR_OWNERSHIP_MAP) {
    if (entry.path.startsWith(prefix)) {
      const relativePath = entry.path.slice(prefix.length);
      paths.add(relativePath);
    }
  }
  return paths;
}

/**
 * RFC-0620: Copy a directory, optionally skipping files whose relative path
 * (relative to the copy root) is in the `skipPaths` set.
 */
async function copyDir(
  src: string,
  dest: string,
  skipPaths?: Set<string>,
  rootSrc?: string,
): Promise<void> {
  if (!existsSync(src)) return;
  await fs.mkdir(dest, { recursive: true });
  const root = rootSrc ?? src;
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath, skipPaths, root);
    } else {
      if (skipPaths && skipPaths.size > 0) {
        const relPath = path.relative(root, srcPath);
        if (skipPaths.has(relPath)) continue;
      }
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * RFC-0389: Generate full runtime boilerplate into the staging Werkstück using
 * onboarding templates and codegen generators, following the onboarding.scaffold pattern.
 * Returns the list of all generated file paths (relative to staging dir).
 */
async function generateFullBoilerplate(
  stagingDir: string,
  systemId: string,
  context: KernelRuntimeContext,
  logger: { info: (msg: string) => void },
): Promise<string[]> {
  const [codegenMod, onboardingMod, checksMod] = await Promise.all([
    import("@warpgogol/werkstatt-site/codegen"),
    import("@warpgogol/werkstatt-site/onboarding"),
    import("@warpgogol/werkstatt-site/checks"),
  ]);
  const {
    runGenerateAgentsDocs,
    runGenerateApiRoutes,
    runGenerateGlobalStyles,
    runGenerateI18nMiddleware,
    runGenerateOverlayPages,
    runGeneratePublicInfrastructure,
    runGenerateRoutes,
    runGenerateScriptsOrchestrator,
    runFontsImportsGenerate,
    runBiomeCssGenerate,
  } = codegenMod;
  const { applyTokens, readTemplate, readRuntimeTemplate } = onboardingMod;
  const { runEnvExampleGenerate } = checksMod;

  const regeneratedFiles: string[] = [];

  // Resolve domain from system.md in the staging directory
  const systemMdPath = path.join(stagingDir, "src", "content", "system.md");
  let domain = "";
  if (existsSync(systemMdPath)) {
    try {
      const raw = readFileSync(systemMdPath, "utf8");
      const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
      if (fmMatch) {
        const domainMatch = fmMatch[1].match(/^  domain:\s*"?([^"\s]+)"?/m);
        if (domainMatch) {
          domain = domainMatch[1];
        }
      }
    } catch (err) {
      logger.info(
        `  Warning: failed to read system.md for domain extraction: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const tokens: Record<string, string> = {
    CLIENT_ID: systemId,
    DOMAIN: domain,
  };

  // Step 1: Write template files into staging directory
  const templateFiles: Array<{ dest: string; content: string }> = [
    { dest: "package.json", content: applyTokens(readTemplate("package.template.json"), tokens) },
    {
      dest: "astro.config.mjs",
      content: applyTokens(
        readRuntimeTemplate("astro.config.template.mjs").replace(
          "// WG_SITE_LINE",
          domain ? `  site: "https://${domain}",` : "  // site: omitted (no domain configured)",
        ),
        tokens,
      ),
    },
    {
      dest: "wrangler.jsonc",
      content: applyTokens(readTemplate("wrangler.template.jsonc"), tokens),
    },
    { dest: "tsconfig.json", content: readTemplate("tsconfig.template.json") },
    { dest: ".gitignore", content: applyTokens(readRuntimeTemplate("gitignore.template"), tokens) },
    { dest: "postcss.config.cjs", content: readRuntimeTemplate("postcss.config.template.cjs") },
    {
      dest: `.github/workflows/deploy-${systemId}.yml`,
      content: applyTokens(readRuntimeTemplate("github-deploy.template.yaml"), tokens),
    },
  ];

  for (const { dest, content } of templateFiles) {
    const fullPath = path.join(stagingDir, dest);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await atomicWriteFile(fullPath, content);
    regeneratedFiles.push(dest);
  }
  logger.info(`  Wrote ${templateFiles.length} template files`);

  // Validate system.md presence before running generators (RFC-0389 failure modes)
  if (!existsSync(systemMdPath)) {
    throw new Error(
      `[mission.materialize] system.md not found in staging directory — Sternsystem data set is incomplete`,
    );
  }

  // Step 2: Construct app-scoped context for the staging Werkstück
  const stagingSiteWorkspace: DiscoveredSiteWorkspace = {
    name: systemId,
    directory: stagingDir,
    toolsDirectory: path.join(stagingDir, "tools"),
    packageName: systemId,
  };

  const generatorInput: KernelCommandInput = {
    argv: [`--app=${systemId}`, `--domain=${domain}`],
    flags: { app: systemId, domain },
  };

  const appContext: KernelRuntimeContext = {
    ...context,
    site: stagingSiteWorkspace,
    siteExplicit: true,
  };

  // Step 3: Run kernel.wire to generate tools/ wiring
  const wireResult = await runKernelWire(generatorInput, appContext);
  const wireData = wireResult.data as Record<string, unknown>;
  const wireGenerated = wireData?.generated;
  if (Array.isArray(wireGenerated)) {
    for (const file of wireGenerated) {
      if (typeof file === "string") {
        regeneratedFiles.push(file);
      }
    }
  }
  logger.info(`  kernel.wire completed`);

  // Step 4: Run codegen generator sequence (same order as onboarding.scaffold)
  const generators: Array<{
    name: string;
    fn: (input: KernelCommandInput, ctx: KernelRuntimeContext) => Promise<KernelCommandResult>;
  }> = [
    { name: "agents.generate", fn: runGenerateAgentsDocs },
    { name: "overlay.pages.generate", fn: runGenerateOverlayPages },
    { name: "routes.generate", fn: runGenerateRoutes },
    { name: "api.routes.generate", fn: runGenerateApiRoutes },
    { name: "styles.global.generate", fn: runGenerateGlobalStyles },
    // biome.css.generate must run after styles.global.generate (which emits
    // global.css with @import "./biome.generated.css") and before dev server
    // launch — without this file PostCSS fails with ENOENT.
    { name: "biome.css.generate", fn: runBiomeCssGenerate },
    { name: "fonts.imports.generate", fn: runFontsImportsGenerate },
    { name: "scripts.orchestrator.generate", fn: runGenerateScriptsOrchestrator },
    { name: "public.infrastructure.generate", fn: runGeneratePublicInfrastructure },
    { name: "i18n.middleware.generate", fn: runGenerateI18nMiddleware },
    { name: "env.example.generate", fn: runEnvExampleGenerate },
  ];

  for (const { name, fn } of generators) {
    const result = await fn(generatorInput, appContext);
    if ((result.exitCode ?? 0) !== 0) {
      throw new Error(
        `[mission.materialize] codegen generator '${name}' failed: ${result.summary}`,
      );
    }
    // Collect generated files from the result
    const data = result.data as Record<string, unknown>;
    const generated = data?.generated;
    if (Array.isArray(generated)) {
      for (const file of generated) {
        if (typeof file === "string") {
          regeneratedFiles.push(file);
        }
      }
    }
    logger.info(`  ${name} completed`);
  }

  // Step 5: Copy .env.example to .env (RFC-0761 / DNA-40)
  // .env.example has empty values with # How to obtain: instructions;
  // .env is the single template for the operator to fill in.
  const envExamplePath = path.join(stagingDir, ".env.example");
  if (existsSync(envExamplePath)) {
    const envExampleContent = await fs.readFile(envExamplePath, "utf8");
    await atomicWriteFile(path.join(stagingDir, ".env"), envExampleContent);
    regeneratedFiles.push(".env.example", ".env");
    logger.info(`  .env.example, .env written`);
  }

  return regeneratedFiles;
}

/**
 * RFC-0356 §1.1 step 2: sync the cache clone (mirrors[0]) from the bare repo (mirrors[1]).
 * If the cache clone has a .git directory, fetch + reset to origin/main.
 * If not but a bare mirror exists, clone it. If no bare mirror, skip (offline mode).
 */
async function syncCacheClone(
  workspaceRoot: string,
  systemId: string,
  logger: { info: (msg: string) => void; warn: (msg: string) => void },
): Promise<void> {
  let config: Awaited<ReturnType<typeof readSystemConfig>> | null = null;
  try {
    config = await readSystemConfig(workspaceRoot, systemId);
  } catch {
    config = null;
  }
  if (!config) {
    logger.info(`  No system-config.yaml for system '${systemId}' — skipping cache clone sync`);
    return;
  }

  const { cachePath, gitMirrors } = resolveMirrors(workspaceRoot, config);
  const gitDir = path.join(cachePath, ".git");

  if (gitMirrors.length === 0) {
    logger.info(`  No bare mirror for system '${systemId}' — skipping cache clone sync`);
    return;
  }

  const bareRepoPath = resolveMirrorPath(workspaceRoot, gitMirrors[0].path);

  if (existsSync(gitDir)) {
    // Cache clone exists — fetch and reset to origin/main
    logger.info(`  Fetching latest from ${bareRepoPath}…`);
    try {
      // Auto-abort any stuck rebase from a previous interrupted sync.
      // .git/rebase-merge or .git/rebase-apply indicates an in-progress rebase
      // that will cause git fetch / git reset to fail with "cannot rebase: you have
      // unstaged changes" or "It seems that there is already a rebase-merge directory".
      const rebaseMerge = path.join(gitDir, "rebase-merge");
      const rebaseApply = path.join(gitDir, "rebase-apply");
      if (existsSync(rebaseMerge) || existsSync(rebaseApply)) {
        logger.warn(`  ⚠ Cache clone has an in-progress rebase — aborting it before sync.`);
        try {
          execSync("git rebase --abort", { cwd: cachePath, stdio: "pipe", timeout: 10_000 });
        } catch {
          // If git rebase --abort fails, manually remove the rebase state directories
          await fs.rm(rebaseMerge, { recursive: true, force: true }).catch(() => {});
          await fs.rm(rebaseApply, { recursive: true, force: true }).catch(() => {});
        }
      }
      // ADR-0031: warn on uncommitted changes before hard reset
      const status = execSync("git status --porcelain", {
        cwd: cachePath,
        encoding: "utf-8",
        timeout: 10_000,
      }).trim();
      if (status) {
        logger.warn(
          `  ⚠ Cache clone has uncommitted changes — they will be lost on reset. Push to bare repo before materializing.`,
        );
      }
      execSync("git fetch origin", { cwd: cachePath, stdio: "pipe", timeout: 30_000 });
      const branch = execSync("git rev-parse --abbrev-ref HEAD", {
        cwd: cachePath,
        encoding: "utf-8",
      }).trim();
      execSync(`git reset --hard origin/${branch}`, {
        cwd: cachePath,
        stdio: "pipe",
        timeout: 30_000,
      });
      logger.info(`  Cache clone synced to origin/${branch}`);
    } catch (err) {
      throw new Error(
        `[mission.materialize] failed to sync cache clone for system '${systemId}': ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else if (existsSync(cachePath)) {
    // Directory exists but is not a git clone — clone into a temp dir and replace
    logger.info(`  Cloning ${bareRepoPath} into cache clone…`);
    const tmpDir = `${cachePath}.clone-${process.pid}-${Date.now()}`;
    try {
      execSync(`git clone "${bareRepoPath}" "${tmpDir}"`, {
        stdio: "pipe",
        timeout: 60_000,
      });
      // Preserve .env and other untracked files from the old directory
      const oldEntries = await fs.readdir(cachePath, { withFileTypes: true });
      for (const e of oldEntries) {
        if (e.name === ".git") continue;
        const src = path.join(cachePath, e.name);
        const dest = path.join(tmpDir, e.name);
        if (!existsSync(dest)) {
          if (e.isDirectory()) {
            await copyDir(src, dest);
          } else {
            await fs.copyFile(src, dest);
          }
        }
      }
      // Replace old directory with the clone
      await fs.rm(cachePath, { recursive: true, force: true });
      await fs.rename(tmpDir, cachePath);
      logger.info(`  Cache clone populated from ${bareRepoPath}`);
    } catch (err) {
      if (existsSync(tmpDir)) {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      }
      throw new Error(
        `[mission.materialize] failed to clone cache clone for system '${systemId}': ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else {
    // Directory doesn't exist — clone directly
    logger.info(`  Cloning ${bareRepoPath} into cache clone…`);
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    try {
      execSync(`git clone "${bareRepoPath}" "${cachePath}"`, {
        stdio: "pipe",
        timeout: 60_000,
      });
      logger.info(`  Cache clone populated from ${bareRepoPath}`);
    } catch (err) {
      throw new Error(
        `[mission.materialize] failed to clone cache clone for system '${systemId}': ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

interface PreflightValidatorResult {
  command: string;
  ok: boolean;
  exitCode: number;
  summary?: string;
}

interface PreflightReport {
  schemaVersion: "1.0.0";
  missionId: string;
  systemId: string;
  criticalPassed: boolean;
  criticalResults: PreflightValidatorResult[];
  warningResults: PreflightValidatorResult[];
  skipped: boolean;
  ranAt: string;
}

async function runPreflightGate(
  workspaceRoot: string,
  workpieceDir: string,
  systemId: string,
  missionId: string,
  skipPreflight: boolean,
  logger: { info: (msg: string) => void },
): Promise<PreflightReport> {
  const ranAt = new Date().toISOString();
  const evidenceDir = path.join(resolveMissionDir(workspaceRoot, missionId), "evidence");
  await fs.mkdir(evidenceDir, { recursive: true });
  const reportPath = path.join(evidenceDir, "preflight-report.json");

  if (skipPreflight) {
    logger.info(`  Preflight skipped (--skip-preflight)`);
    const report: PreflightReport = {
      schemaVersion: "1.0.0",
      missionId,
      systemId,
      criticalPassed: true,
      criticalResults: [],
      warningResults: [],
      skipped: true,
      ranAt,
    };
    await atomicWriteFile(reportPath, JSON.stringify(report, null, 2) + "\n");
    return report;
  }

  async function runSteps(
    steps: KernelPipelineStep[],
    siteName: string,
  ): Promise<PreflightValidatorResult[]> {
    const results: PreflightValidatorResult[] = [];
    for (const step of steps) {
      logger.info(`  Preflight: ${step.command}…`);
      try {
        const execResult = await executeKernelCommand({
          workspaceRoot,
          commandName: step.command,
          siteName,
          siteExplicit: true,
        });
        const single = Array.isArray(execResult) ? execResult[0] : execResult;
        const ok = single?.ok ?? false;
        const exitCode = single?.exitCode ?? 1;
        const summary = single?.summary ?? "";
        results.push({ command: step.command, ok, exitCode, summary });
        if (!ok) {
          logger.info(`    ${step.command}: FAIL (exit ${exitCode})`);
        } else {
          logger.info(`    ${step.command}: pass`);
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        results.push({
          command: step.command,
          ok: false,
          exitCode: 1,
          summary: `error: ${errMsg}`,
        });
        logger.info(`    ${step.command}: ERROR — ${errMsg}`);
      }
    }
    return results;
  }

  const { MISSION_PREFLIGHT_CRITICAL, MISSION_PREFLIGHT_WARNING } =
    await import("@warpgogol/werkstatt-site/checks");
  const criticalResults = await runSteps(MISSION_PREFLIGHT_CRITICAL, systemId);
  const warningResults = await runSteps(MISSION_PREFLIGHT_WARNING, systemId);
  const criticalPassed = criticalResults.every((r) => r.ok);

  const report: PreflightReport = {
    schemaVersion: "1.0.0",
    missionId,
    systemId,
    criticalPassed,
    criticalResults,
    warningResults,
    skipped: false,
    ranAt,
  };
  await atomicWriteFile(reportPath, JSON.stringify(report, null, 2) + "\n");

  if (!criticalPassed) {
    const failures = criticalResults
      .filter((r) => !r.ok)
      .map((r) => `  ${r.command}: ${r.summary ?? "failed"}`)
      .join("\n");
    throw new Error(
      `[mission.materialize] preflight content quality gate FAILED — critical validators did not pass:\n${failures}\n\n` +
        `Workpiece preserved at ${workpieceDir} (no git init). ` +
        `See evidence/preflight-report.json for details. ` +
        `Fix the Sternsystem data set (systems/${systemId}/) and re-run mission.materialize, ` +
        `or use --skip-preflight to bypass (Bordbuch-audited).`,
    );
  }

  const warningFailures = warningResults.filter((r) => !r.ok);
  if (warningFailures.length > 0) {
    logger.info(
      `  Preflight: ${warningFailures.length} warning${warningFailures.length === 1 ? "" : "s"} — see evidence/preflight-report.json`,
    );
  }

  return report;
}

// RFC-0647: ensurePlaywrightChromium extracted to @warpgogol/site-kernel-checks as ensureChromium.

// RFC-0659: Artifact cache directory and state file paths.
// The state file lives inside .cache/ so it is automatically gitignored.
const ARTIFACT_CACHE_DIR = ".cache/materialization";
const ARTIFACT_CACHE_STATE_FILE = ".cache/materialization-state.json";

/**
 * RFC-0659: Compute the artifact cache key from cacheCloneHead, platformVersion,
 * and platformSemanticHash. Returns the hash and the individual components for
 * writing to the cache state file.
 */
async function computeArtifactCacheKey(
  workspaceRoot: string,
  cacheCloneHead: string,
): Promise<{ cacheKey: string; platformVersion: string; platformSemanticHash: string }> {
  const { version: platformVersion } = await resolveCurrentEcosystem(workspaceRoot);
  const platformSemanticHash = await resolvePlatformSemanticHash(workspaceRoot);
  const cacheKey = byteHash(`${cacheCloneHead}|${platformVersion}|${platformSemanticHash}`);
  return { cacheKey, platformVersion, platformSemanticHash };
}

/**
 * RFC-0659: Resolve the current cache clone HEAD. Returns null if HEAD cannot
 * be resolved (non-git cache clone, empty repo).
 */
function resolveCacheCloneHead(systemDir: string): string | null {
  try {
    return execSync("git rev-parse HEAD", {
      cwd: systemDir,
      stdio: "pipe",
      encoding: "utf-8",
    }).trim();
  } catch {
    return null;
  }
}

/**
 * RFC-0659: Read the artifact cache state file. Returns null if the file does
 * not exist or is corrupt.
 */
async function readArtifactCacheState(
  systemDir: string,
): Promise<MaterializationCacheState | null> {
  const statePath = path.join(systemDir, ARTIFACT_CACHE_STATE_FILE);
  if (!existsSync(statePath)) return null;
  try {
    const raw = await fs.readFile(statePath, "utf8");
    return JSON.parse(raw) as MaterializationCacheState;
  } catch {
    return null;
  }
}

/**
 * RFC-0659: Copy a directory tree, excluding specified top-level entries.
 * Used to snapshot the workpiece (excluding .git/ and node_modules/) to the cache.
 */
async function copyDirExcluding(
  src: string,
  dest: string,
  excludeTopLevel: Set<string>,
): Promise<void> {
  if (!existsSync(src)) return;
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    if (excludeTopLevel.has(entry.name)) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * RFC-0659: Write the artifact cache state file and ensure .cache/ is gitignored
 * in the cache clone. The state file lives inside .cache/ so it is automatically
 * gitignored. The .gitignore update is written but NOT committed — committing
 * would change the cache clone HEAD and invalidate the cache key on the next run.
 */
async function writeArtifactCacheState(
  systemDir: string,
  state: MaterializationCacheState,
  _logger: { info: (msg: string) => void; warn: (msg: string) => void },
): Promise<void> {
  const statePath = path.join(systemDir, ARTIFACT_CACHE_STATE_FILE);
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await atomicWriteFile(statePath, JSON.stringify(state, null, 2) + "\n");

  // RFC-0659: Ensure .cache/ is in the cache clone's .gitignore.
  // Written but not committed — committing would change the cache clone HEAD
  // and invalidate the cache key on the next materialization.
  const gitignorePath = path.join(systemDir, ".gitignore");
  let gitignoreContent = "";
  if (existsSync(gitignorePath)) {
    gitignoreContent = await fs.readFile(gitignorePath, "utf8");
  }
  if (!gitignoreContent.includes(".cache/")) {
    const newContent =
      gitignoreContent.endsWith("\n") || gitignoreContent === ""
        ? gitignoreContent + ".cache/\n"
        : gitignoreContent + "\n.cache/\n";
    await atomicWriteFile(gitignorePath, newContent);
  }
}

export interface MissionMaterializeInternalOptions {
  reportOnly: boolean;
  skipPreflight: boolean;
  force: boolean;
}

export async function runMissionMaterializeInternal(
  workspaceRoot: string,
  manifest: MissionManifest,
  context: KernelRuntimeContext,
  options: MissionMaterializeInternalOptions,
): Promise<KernelCommandResult<MissionMaterializeData>> {
  const { logger } = context;
  const missionId = manifest.missionId;
  const operationId = manifest.operationId;
  const { reportOnly, skipPreflight, force } = options;

  // RFC-0480: refuse materialization on paused Sternsystem (external edit detection)
  const config = await readSystemConfig(workspaceRoot, manifest.systemId);
  if (config?.status === "paused") {
    throw new Error(
      `[mission.materialize] system '${manifest.systemId}' is paused due to external edit detection. Run sternsystem.validate for details.`,
    );
  }

  const systemDir = resolveCacheClonePath(workspaceRoot, manifest.systemId);

  // RFC-0356 §1.1 step 2: fetch the latest remote state into the cache clone.
  await syncCacheClone(workspaceRoot, manifest.systemId, logger);

  // RFC-0658: Install bordbuch pre-commit hook in cache clone to prevent
  // accidental deletion of bordbuch/events.ndjson via git add -A + commit.
  // Non-fatal: non-git cache clones skip hook installation silently.
  let bordbuchHookInstalled = false;
  try {
    const hookResult = await installBordbuchPreCommitHook(systemDir, manifest.systemId);
    bordbuchHookInstalled = hookResult.installed;
    if (hookResult.installed) {
      logger.info(`  Installed bordbuch pre-commit hook in cache clone`);
    }
  } catch (err) {
    logger.warn(
      `  Failed to install bordbuch pre-commit hook: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const pinPath = path.join(systemDir, "system.pin.json");

  if (!existsSync(pinPath)) {
    throw new Error(`[mission.materialize] system '${manifest.systemId}' has no system.pin.json`);
  }

  const pinRaw = await fs.readFile(pinPath, "utf8");
  const pin = JSON.parse(pinRaw);
  const pinVersion = pin.platform?.version ?? "unknown";

  // Read current platform version from workspace root package.json
  const workspacePkgPath = path.join(workspaceRoot, "package.json");
  const workspacePkg = JSON.parse(await fs.readFile(workspacePkgPath, "utf8"));
  const platformVersion = workspacePkg.version ?? "unknown";

  // Version comparison (simplified — full implementation would use compareEcosystem)
  let verdict: "in-sync" | "catch-up" | "refuse-downgrade" = "in-sync";
  let message = `in sync at ${pinVersion}; no migration needed.`;

  const order = compareSemver(pinVersion, platformVersion);
  if (order > 0) {
    verdict = "refuse-downgrade";
    message = `platform (${platformVersion}) is older than pin (${pinVersion}) — update the platform and retry`;
  } else if (order < 0) {
    verdict = "catch-up";
    message = `catch-up from ${pinVersion} to ${platformVersion} required`;
  }

  logger.info(`  Version comparison: ${verdict}`);
  logger.info(`  Pin: ${pinVersion}, Platform: ${platformVersion}`);

  if (verdict === "refuse-downgrade") {
    throw new Error(`[mission.materialize] ${message}`);
  }

  if (reportOnly) {
    return {
      data: {
        missionId,
        systemId: manifest.systemId,
        versionComparison: {
          verdict,
          pinVersion,
          platformVersion,
          packagesDrift: false,
          message,
        },
        migratorChain: [],
        capabilityDiff: { tier: "green", items: [] },
        regeneration: { regeneratedFiles: [], success: true },
        materializedAt: new Date().toISOString(),
        preflightSkipped: false,
        preflightSkipReason: null,
        pipelineUsed: "build.prepare.dev",
        mediaCacheWarmed: false,
        mediaCacheSources: 0,
        bordbuchHookInstalled: false,
        artifactCacheHit: false,
        artifactCacheKey: null,
        artifactCacheSkipped: false,
        workspaceGlobCheck: { stalePackages: [], ok: true },
      },
      summary: `[mission.materialize] ${missionId} report-only: ${verdict}`,
      nextSteps: [
        {
          action: `Materialize for real: pnpm exec werkstatt run mission.materialize --mission ${missionId} --skip-preflight=false`,
          kind: "required",
        },
      ],
    };
  }

  // RFC-0597: Read materialization state file and determine if preflight can be skipped
  let preflightSkipped = false;
  let preflightSkipReason: string | null = null;

  if (!skipPreflight) {
    const stateFilePath = path.join(systemDir, ".materialization-state.json");
    if (existsSync(stateFilePath)) {
      try {
        const stateRaw = await fs.readFile(stateFilePath, "utf8");
        const state = JSON.parse(stateRaw) as MaterializationState;
        // Get current cache clone HEAD
        let currentHead: string | null = null;
        try {
          currentHead = execSync("git rev-parse HEAD", {
            cwd: systemDir,
            stdio: "pipe",
            encoding: "utf-8",
          }).trim();
        } catch {
          // HEAD cannot be resolved — fail safe, run preflight
        }
        if (currentHead && state.cacheCloneHead === currentHead) {
          preflightSkipped = true;
          preflightSkipReason = "cache-clone-head-unchanged";
          logger.info(`  Preflight skip: cache clone HEAD unchanged (${currentHead.slice(0, 12)})`);
        }
      } catch {
        // Corrupt state file — fail safe, run preflight
      }
    }
  }

  // RFC-0659: Compute artifact cache key and check for cache hit.
  // The cache key combines cacheCloneHead, platformVersion, and platformSemanticHash.
  // On cache hit, the workpiece is restored from cache — skipping codegen and build.prepare.dev.
  // The --force flag bypasses cache read but still writes a fresh cache entry after full materialization.
  let artifactCacheHit = false;
  let artifactCacheKey: string | null = null;
  let artifactCacheSkipped = false;
  let cacheCloneHead: string | null = null;
  let artifactCacheKeyComponents: {
    platformVersion: string;
    platformSemanticHash: string;
  } | null = null;

  if (!reportOnly) {
    cacheCloneHead = resolveCacheCloneHead(systemDir);
    if (cacheCloneHead) {
      try {
        const keyResult = await computeArtifactCacheKey(workspaceRoot, cacheCloneHead);
        artifactCacheKey = keyResult.cacheKey;
        artifactCacheKeyComponents = {
          platformVersion: keyResult.platformVersion,
          platformSemanticHash: keyResult.platformSemanticHash,
        };

        if (!force) {
          const cacheState = await readArtifactCacheState(systemDir);
          if (cacheState && cacheState.cacheKey === artifactCacheKey) {
            const cacheDir = path.join(systemDir, ARTIFACT_CACHE_DIR, artifactCacheKey);
            if (existsSync(cacheDir)) {
              artifactCacheHit = true;
              logger.info(`  Artifact cache hit (key: ${artifactCacheKey.slice(0, 12)})`);
            } else {
              logger.warn(
                `  Artifact cache: state file exists but cache directory missing — falling through to full materialization`,
              );
              try {
                await fs.unlink(path.join(systemDir, ARTIFACT_CACHE_STATE_FILE));
              } catch {
                // ignore
              }
            }
          }
        } else {
          artifactCacheSkipped = true;
          logger.info(`  Artifact cache: bypassed (--force)`);
        }
      } catch (err) {
        logger.warn(
          `  Artifact cache: key computation failed — ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  // Stage Werkstück
  const missionDir = resolveMissionDir(workspaceRoot, missionId);
  const workpieceDir = path.join(missionDir, "workpiece");
  const stagingDir = resolveStagingDir(missionDir, workpieceDir, operationId);

  // Clean any existing staging
  if (existsSync(stagingDir)) {
    await fs.rm(stagingDir, { recursive: true, force: true });
  }
  await fs.mkdir(stagingDir, { recursive: true });

  // RFC-0568: Clone cache clone into staging dir instead of git init.
  // This creates a shared git object database between workpiece and cache clone,
  // enabling git merge --no-ff during reconcile instead of fragile git am patches.
  // Only clone if the cache clone has a .git directory; otherwise fall through to
  // the existing copyDir flow for non-git Sternsystems.
  const hasGitCacheClone = existsSync(path.join(systemDir, ".git"));
  let clonedGitDir: string | null = null;

  if (hasGitCacheClone) {
    // Clone into a temporary directory first, then move .git into staging
    const tempCloneDir = path.join(missionDir, `.clone-${operationId}`);
    if (existsSync(tempCloneDir)) {
      await fs.rm(tempCloneDir, { recursive: true, force: true });
    }
    execSync(`git clone ${JSON.stringify(systemDir)} ${JSON.stringify(tempCloneDir)}`, {
      stdio: ["pipe", "pipe", "pipe"],
    });
    // Move .git from temp clone into staging
    clonedGitDir = path.join(stagingDir, ".git");
    await fs.rename(path.join(tempCloneDir, ".git"), clonedGitDir);
    // Clean up temp clone (everything except .git was moved)
    await fs.rm(tempCloneDir, { recursive: true, force: true });
    logger.info(`  Cloned cache clone git history into staging`);
  }

  // RFC-0659: On cache hit, restore the workpiece from the artifact cache directory.
  // On cache miss (or --force), run the full data-path copy + boilerplate generation flow.
  let regeneratedFiles: string[] = [];
  let mediaCacheWarmed = false;
  let mediaCacheSources = 0;

  if (artifactCacheHit && artifactCacheKey) {
    const cacheDir = path.join(systemDir, ARTIFACT_CACHE_DIR, artifactCacheKey);
    // Restore cached workpiece into staging (excluding .git/ — already provided by clone)
    await copyDirExcluding(cacheDir, stagingDir, new Set([".git"]));
    logger.info(`  Restored workpiece from artifact cache`);
  } else {
    // RFC-0620: Build skip set of workspace-absolute generated paths.
    // These are generated artifacts (e.g. bordbuch projections) that belong in
    // the cache clone, not the workpiece. Filtering them at copy time avoids
    // ownership.sync.validate OWN-01 failures.
    const skipPathsGlobal = await getWorkspaceAbsoluteGeneratedPaths();

    // Copy data set from Sternsystem
    for (const dataPath of STERNSYSTEM_DATA_PATHS) {
      const src = path.join(systemDir, dataPath);
      const dest = path.join(stagingDir, dataPath);
      if (!existsSync(src)) continue;
      const stat = await fs.stat(src);
      if (stat.isDirectory()) {
        // RFC-0620: filter skip set to entries within this data path,
        // then strip the data-path prefix to get paths relative to the copy root.
        const dataSkipPaths = new Set<string>();
        const dataPrefix = dataPath + "/";
        for (const skipPath of skipPathsGlobal) {
          if (skipPath.startsWith(dataPrefix)) {
            dataSkipPaths.add(skipPath.slice(dataPrefix.length));
          }
        }
        await copyDir(src, dest, dataSkipPaths.size > 0 ? dataSkipPaths : undefined);
      } else {
        // Single file — skip if it matches a workspace-absolute generated path
        if (!skipPathsGlobal.has(dataPath)) {
          await fs.mkdir(path.dirname(dest), { recursive: true });
          await fs.copyFile(src, dest);
        }
      }
      logger.info(`  Copied ${dataPath}`);
    }

    // RFC-0620: Remove workspace-absolute generated files that entered the
    // staging dir via git clone (RFC-0568). The clone brings all cache-clone
    // files into the working tree; the non-data-path removal above keeps only
    // STERNSYSTEM_DATA_PATHS, but workspace-absolute generated files within
    // those data paths (e.g. public/.well-known/bordbuch.json) survive because
    // they are inside a kept data path. The copy step above skips them, but
    // the cloned copies remain. Remove them here using the ownership map.
    for (const skipPath of skipPathsGlobal) {
      const stagingPath = path.join(stagingDir, skipPath);
      if (existsSync(stagingPath)) {
        await fs.rm(stagingPath, { force: true });
      }
    }

    // RFC-0479: copy system.pin.json to workpiece root so mission.migrate can read migratorCursor
    const pinFileSrc = path.join(systemDir, "system.pin.json");
    if (existsSync(pinFileSrc)) {
      await fs.copyFile(pinFileSrc, path.join(stagingDir, "system.pin.json"));
      logger.info(`  Copied system.pin.json`);
    }

    // RFC-0568: After clone, remove ALL non-data-path files from the working tree.
    // The clone brought cache-clone-local files (bordbuch/, etc.) that must not
    // enter the workpiece. Only keep STERNSYSTEM_DATA_PATHS + system.pin.json.
    // The .git directory is preserved (it's in .git/, not in the working tree).
    if (clonedGitDir) {
      const keepPaths = new Set([...STERNSYSTEM_DATA_PATHS, "system.pin.json", ".git"]);
      const stagingEntries = await fs.readdir(stagingDir, { withFileTypes: true });
      for (const entry of stagingEntries) {
        // Check if entry name is an exact match OR a parent directory of any keep path
        // (e.g. "src" is the parent of "src/content")
        const isKeepPath =
          keepPaths.has(entry.name) || [...keepPaths].some((kp) => kp.startsWith(`${entry.name}/`));
        if (!isKeepPath) {
          const entryPath = path.join(stagingDir, entry.name);
          await fs.rm(entryPath, { recursive: true, force: true });
        }
      }
    }

    // RFC-0597: Warm media cache from cache clone to workpiece after data-path copy
    for (const cacheDir of MEDIA_CACHE_DIRS) {
      const srcCache = path.join(systemDir, cacheDir);
      if (existsSync(srcCache)) {
        const destCache = path.join(stagingDir, cacheDir);
        try {
          // Replace (not merge) — stale entries from failed runs do not persist
          if (existsSync(destCache)) {
            await fs.rm(destCache, { recursive: true, force: true });
          }
          await copyDir(srcCache, destCache);
          mediaCacheWarmed = true;
          mediaCacheSources++;
          logger.info(`  Warmed ${cacheDir} from cache clone`);
        } catch (err) {
          logger.info(
            `  Warning: failed to warm ${cacheDir} from cache clone: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    // Generate full runtime boilerplate from onboarding templates and codegen generators (RFC-0389)
    regeneratedFiles = await generateFullBoilerplate(
      stagingDir,
      manifest.systemId,
      context,
      logger,
    );
  } // end if (!artifactCacheHit) — RFC-0659 artifact cache branch

  // RFC-0822: Restore .env* files from cache clone after atomicMoveDir.
  // Replaces the old-workpiece preservation code (lines 1154–1196).
  // The cache clone is the canonical inter-mission store for secrets.
  // Non-fatal: failure logs a warning, materialize proceeds with .env.example.
  await atomicMoveDir(stagingDir, workpieceDir, { replace: true });

  const cacheCloneDir = resolveCacheClonePath(workspaceRoot, manifest.systemId);
  try {
    const envResult = await restoreEnvFilesFromCacheClone(cacheCloneDir, workpieceDir);
    if (envResult.copied.length > 0) {
      logger.info(
        `  Restored ${envResult.copied.length} .env file(s) from cache clone: ${envResult.copied.join(", ")}`,
      );
    } else {
      logger.warn(
        `  Warning: no .env files found in cache clone — using .env.example template. Operator must fill secrets manually.`,
      );
    }
    if (envResult.skipped.length > 0) {
      logger.warn(`  Warning: failed to restore .env file(s): ${envResult.skipped.join(", ")}`);
    }
  } catch (envErr) {
    logger.warn(
      `  Warning: failed to restore .env files from cache clone: ${envErr instanceof Error ? envErr.message : String(envErr)}`,
    );
  }
  process.env["PUBLIC_IMAGE_PROVIDER"] = "build-portable";
  logger.info(`  PUBLIC_IMAGE_PROVIDER set to build-portable in .env files`);

  // RFC-0870: Restore registry-only generated files from git after atomicMoveDir.
  // The staging dir may lack committed generated manifests (e.g. image-variants.generated.yaml)
  // because they are not in STERNSYSTEM_DATA_PATHS and were not regenerated during boilerplate.
  // Use `git checkout` to restore them from the workpiece's git HEAD (cloned from cache clone).
  // Non-fatal: failure logs a warning, materialize proceeds — build.prepare will regenerate.
  try {
    const { GENERATOR_OWNERSHIP_MAP } =
      await import("@warpgogol/werkstatt-site/checks/generator-ownership");
    const registryOnlyNonConditional = GENERATOR_OWNERSHIP_MAP.filter(
      (e: { markerPolicy?: string; conditional?: boolean; path: string }) =>
        e.markerPolicy === "registry-only" && !e.conditional,
    );
    let restoredCount = 0;
    for (const entry of registryOnlyNonConditional) {
      try {
        execSync(`git checkout HEAD -- ${entry.path}`, {
          cwd: workpieceDir,
          stdio: ["pipe", "pipe", "pipe"],
          encoding: "utf-8",
        });
        restoredCount++;
      } catch {
        // File not tracked in git or does not exist in HEAD — skip
      }
    }
    if (restoredCount > 0) {
      logger.info(`  Restored ${restoredCount} registry-only generated file(s) from git`);
    }
  } catch (restoreErr) {
    logger.warn(
      `  Warning: failed to restore registry-only generated files: ${restoreErr instanceof Error ? restoreErr.message : String(restoreErr)}`,
    );
  }

  // RFC-0840: Restore operator config files from cache clone after atomicMoveDir.
  // Done after .env* restoration — same pattern, different file set.
  // Non-fatal: failure logs a warning, materialize proceeds without the files.
  try {
    const operatorConfigResult = await restoreOperatorConfigFiles(cacheCloneDir, workpieceDir);
    if (operatorConfigResult.copied.length > 0) {
      logger.info(
        `  Restored ${operatorConfigResult.copied.length} operator config file(s) from cache clone: ${operatorConfigResult.copied.join(", ")}`,
      );
    }
    if (operatorConfigResult.skipped.length > 0) {
      logger.warn(
        `  Warning: failed to restore operator config file(s): ${operatorConfigResult.skipped.join(", ")}`,
      );
    }
  } catch (operatorConfigErr) {
    logger.warn(
      `  Warning: failed to restore operator config files from cache clone: ${operatorConfigErr instanceof Error ? operatorConfigErr.message : String(operatorConfigErr)}`,
    );
  }

  // RFC-0796: Pre-flight guard — check workspace globs for stale package.json references
  // before pnpm install. Aborts with clear error if stale references found.
  const workspaceGlobCheck = await checkWorkspaceGlobsForStalePackages(workspaceRoot);
  if (!workspaceGlobCheck.ok) {
    const staleList = workspaceGlobCheck.stalePackages.join("\n  ");
    throw new Error(
      `[mission.materialize] stale workspace references detected — pnpm install would fail.\n` +
        `  Stale packages:\n  ${staleList}\n` +
        `  Run 'mission.archive --status closed' to move terminal-state missions to archive,\n` +
        `  then re-run mission.materialize.`,
    );
  }
  logger.info(`  Workspace glob check passed (no stale package references)`);

  // Link workpiece into pnpm workspace before build.prepare runs.
  // The fresh workpiece has no node_modules — without this step, workpiece.imports.validate
  // (first step of build.prepare) fails because @warpgogol/* symlinks don't exist yet.
  logger.info(`  Linking workpiece workspace dependencies…`);
  try {
    execSync("pnpm install", {
      cwd: workspaceRoot,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 120_000,
    });
    logger.info(`  Workpiece workspace dependencies linked`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `[mission.materialize] pnpm install failed — workpiece cannot be linked into workspace.\n` +
        `  Error: ${msg}\n` +
        `  Run 'pnpm install' manually at the workspace root, then re-run mission.materialize.`,
    );
  }

  // RFC-0647: Ensure Playwright Chromium is installed (needed by build.post → print.pdf.generate
  // and independent-qa). Idempotent — skips if Chromium is already launchable.
  // Non-fatal: log and continue if install fails.
  try {
    const { ensureChromium } = await import("@warpgogol/werkstatt-site/checks");
    await ensureChromium(workspaceRoot, logger);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(
      `  Playwright Chromium: ensure failed (non-fatal) — ${msg}. ` +
        `Run 'pnpm exec playwright install chromium' manually before build:check.`,
    );
  }

  // RFC-0597/RFC-0659: Run build.prepare.dev pipeline (codegen-only) on cache miss.
  // On cache hit, build.prepare.dev is skipped — the cached workpiece already has all generated artifacts.
  let prepareReport: {
    ok: boolean;
    steps: Array<{ ok: boolean; commandName: string; exitCode: number }>;
  };

  if (artifactCacheHit) {
    // RFC-0659: Cache hit — build.prepare.dev is skipped. Construct a synthetic report
    // indicating the pipeline was skipped due to artifact cache hit.
    prepareReport = { ok: true, steps: [] };
    logger.info(`  build.prepare.dev skipped (artifact cache hit)`);
  } else {
    logger.info(`  Running build.prepare.dev pipeline for ${manifest.systemId}…`);
    const prepareResult = await executeKernelPipeline({
      workspaceRoot,
      pipelineName: "build.prepare.dev",
      siteName: manifest.systemId,
      outputFormat: "pretty",
      force: true,
    });
    prepareReport = Array.isArray(prepareResult) ? prepareResult[0] : prepareResult;
    if (!prepareReport.ok) {
      const failedSteps = prepareReport.steps
        .filter((s) => !s.ok)
        .map((s) => `${s.commandName} (exit ${s.exitCode})`);
      throw new Error(
        `[mission.materialize] build.prepare pipeline FAILED — ${failedSteps.length} step(s) failed:\n` +
          failedSteps.map((s) => `  - ${s}`).join("\n") +
          `\n\nWorkpiece preserved at ${workpieceDir} (no git init).`,
      );
    }
  }
  logger.info(
    `  build.prepare completed (${prepareReport.steps.length} steps, ${prepareReport.steps.filter((s) => s.ok).length} OK)`,
  );

  // RFC-0517: preflight content quality gate — runs after atomicMoveDir, before git init
  // RFC-0597: preflight is skipped if --skip-preflight flag is set OR state file HEAD matches
  const effectiveSkipPreflight = skipPreflight || preflightSkipped;
  const _preflightReport = await runPreflightGate(
    workspaceRoot,
    workpieceDir,
    manifest.systemId,
    missionId,
    effectiveSkipPreflight,
    logger,
  );

  // RFC-0517/RFC-0597: append Bordbuch entry when preflight is skipped (RFC-0750: commit atomically)
  if (skipPreflight) {
    await appendAndCommitBordbuch(
      workspaceRoot,
      manifest.systemId,
      "preflight-skipped",
      `Preflight content quality gate skipped via --skip-preflight flag for mission ${missionId}`,
      "agent",
      {
        writerRole: "mission",
        missionId,
        metadata: { reason: "operator override via --skip-preflight flag" },
      },
      `Bordbuch: preflight-skipped ${missionId}`,
    );
    logger.info(`  Bordbuch: preflight-skipped entry appended`);
  } else if (preflightSkipped) {
    await appendAndCommitBordbuch(
      workspaceRoot,
      manifest.systemId,
      "preflight-skipped",
      `Preflight content quality gate skipped — cache clone HEAD unchanged for mission ${missionId}`,
      "agent",
      {
        writerRole: "mission",
        missionId,
        metadata: { reason: "cache-clone-head-unchanged" },
      },
      `Bordbuch: preflight-skipped ${missionId}`,
    );
    logger.info(`  Bordbuch: preflight-skipped entry appended (cache-clone-head-unchanged)`);
  }

  // RFC-0568: Clone-based materialization — git commit with data-only staging.
  // Only stage STERNSYSTEM_DATA_PATHS + system.pin.json. Boilerplate files remain
  // untracked, ensuring git merge --no-ff during reconcile transfers only data-path
  // changes into the cache clone (DNA-44 Sternsystem data-only contract compliance).
  if (existsSync(path.join(workpieceDir, ".git"))) {
    const dataPathsToAdd = [...STERNSYSTEM_DATA_PATHS, "system.pin.json"];
    for (const dataPath of dataPathsToAdd) {
      const fullPath = path.join(workpieceDir, dataPath);
      if (existsSync(fullPath)) {
        execSync(`git add -- ${JSON.stringify(dataPath)}`, {
          cwd: workpieceDir,
          stdio: ["pipe", "pipe", "pipe"],
        });
      }
    }
    execSync(`git commit -m "materialize from pin ${pinVersion}"`, {
      cwd: workpieceDir,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        MISSION_GIT_COMMIT: "1",
        GIT_AUTHOR_NAME: "mission.materialize",
        GIT_AUTHOR_EMAIL: "mission@warpgogol.local",
        GIT_COMMITTER_NAME: "mission.materialize",
        GIT_COMMITTER_EMAIL: "mission@warpgogol.local",
      },
    });
    // RFC-0821: Install workpiece commit guard hook
    await installWorkpieceCommitHook(workpieceDir);
    logger.info(`  Git commit created in workpiece (data-only, on top of cloned history)`);
  } else {
    // RFC-0568: Non-git cache clone fallback — use git init (no shared history)
    // RFC-0648: use -b main to enforce main branch convention
    execSync("git init -b main", { cwd: workpieceDir, stdio: ["pipe", "pipe", "pipe"] });
    const dataPathsToAdd = [...STERNSYSTEM_DATA_PATHS, "system.pin.json"];
    for (const dataPath of dataPathsToAdd) {
      const fullPath = path.join(workpieceDir, dataPath);
      if (existsSync(fullPath)) {
        execSync(`git add -- ${JSON.stringify(dataPath)}`, {
          cwd: workpieceDir,
          stdio: ["pipe", "pipe", "pipe"],
        });
      }
    }
    execSync(`git commit -m "materialize from pin ${pinVersion}"`, {
      cwd: workpieceDir,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        MISSION_GIT_COMMIT: "1",
        GIT_AUTHOR_NAME: "mission.materialize",
        GIT_AUTHOR_EMAIL: "mission@warpgogol.local",
        GIT_COMMITTER_NAME: "mission.materialize",
        GIT_COMMITTER_EMAIL: "mission@warpgogol.local",
      },
    });
    // RFC-0821: Install workpiece commit guard hook
    await installWorkpieceCommitHook(workpieceDir);
    logger.info(
      `  Git initialized in workpiece with initial commit (non-git cache clone fallback)`,
    );
  }

  // RFC-0659: Write workpiece to artifact cache on cache miss (or --force).
  // The cache snapshot excludes .git/ and node_modules/ to keep it lean.
  // Previous cache entries are deleted (keep only latest).
  if (!artifactCacheHit && artifactCacheKey && cacheCloneHead && artifactCacheKeyComponents) {
    try {
      const cacheBaseDir = path.join(systemDir, ARTIFACT_CACHE_DIR);
      // Clean previous cache entries
      if (existsSync(cacheBaseDir)) {
        const entries = await fs.readdir(cacheBaseDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name !== artifactCacheKey) {
            await fs.rm(path.join(cacheBaseDir, entry.name), { recursive: true, force: true });
          }
        }
      }
      // Write new cache entry
      const newCacheDir = path.join(cacheBaseDir, artifactCacheKey);
      await copyDirExcluding(workpieceDir, newCacheDir, new Set([".git", "node_modules", "dist"]));
      logger.info(`  Artifact cache: wrote entry (${artifactCacheKey.slice(0, 12)})`);

      // Write state file
      await writeArtifactCacheState(
        systemDir,
        {
          systemId: manifest.systemId,
          cacheKey: artifactCacheKey,
          cacheCloneHead,
          platformVersion: artifactCacheKeyComponents.platformVersion,
          platformSemanticHash: artifactCacheKeyComponents.platformSemanticHash,
          writtenAt: new Date().toISOString(),
        },
        logger,
      );
    } catch (err) {
      logger.warn(
        `  Artifact cache: write failed (non-fatal) — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // RFC-0617: Seed compass-audit ledger for workpiece files.
  // Runs after codegen + git commit so all authored files exist and have a revision.
  // Non-fatal: a baseline failure logs a warning but does not block materialization.
  const workpieceRelPath = path.relative(workspaceRoot, workpieceDir);
  logger.info(`  Running compass.audit.baseline for workpiece…`);
  try {
    await executeKernelCommand({
      workspaceRoot,
      commandName: "compass.audit.baseline",
      argv: [`--workpiece=${workpieceRelPath}`],
    });
    logger.info(`  Compass audit baseline seeded for workpiece`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`  Warning: compass.audit.baseline failed: ${msg}`);
  }

  // Write materialization report
  const evidenceDir = path.join(missionDir, "evidence");
  await fs.mkdir(evidenceDir, { recursive: true });
  const now = new Date().toISOString();
  const report = {
    schemaVersion: "1.0.0",
    missionId,
    systemId: manifest.systemId,
    versionComparison: { verdict, pinVersion, platformVersion, packagesDrift: false, message },
    migratorChain: [],
    capabilityDiff: { tier: "green" as const, items: [] },
    regeneration: { regeneratedFiles, success: true },
    buildPrepare: {
      steps: prepareReport.steps.length,
      passed: prepareReport.steps.filter((s) => s.ok).length,
      failed: prepareReport.steps.filter((s) => !s.ok).length,
    },
    preflightSkipped: skipPreflight || preflightSkipped,
    preflightSkipReason: skipPreflight ? "operator-override" : preflightSkipReason,
    pipelineUsed: "build.prepare.dev",
    mediaCacheWarmed,
    mediaCacheSources,
    bordbuchHookInstalled,
    artifactCacheHit,
    artifactCacheKey,
    artifactCacheSkipped,
    workspaceGlobCheck,
    materializedAt: now,
  };
  await atomicWriteFile(
    path.join(evidenceDir, "materialization-report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );

  // Update mission manifest
  manifest.materializedAt = now;
  await writeMissionManifest(workspaceRoot, manifest);

  // RFC-0580: auto-commit werkstatt side-effects
  await commitWerkstattSideEffects(
    workspaceRoot,
    [path.join("missions", missionId, "mission.yaml"), "pnpm-lock.yaml"],
    `werkstatt: mission.materialize ${missionId}`,
  );

  return {
    data: report,
    summary: `[mission.materialize] ${missionId} materialized (${verdict}, green)`,
    nextSteps: [
      {
        action: `Edit content in missions/${missionId}/workpiece/src/content/, then run: pnpm exec werkstatt run mission.validate --mission ${missionId}`,
        kind: "required",
      },
    ],
  };
}

export async function runMissionMaterialize(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<MissionMaterializeData>> {
  const { workspaceRoot } = context;
  const missionId = flagString(input, "mission");
  const reportOnly = flagBool(input, "report-only");
  const skipPreflight = flagBool(input, "skip-preflight");
  const force = flagBool(input, "force");

  if (!missionId) throw new Error("[mission.materialize] --mission is required");

  const manifest = await readMissionManifest(workspaceRoot, missionId);

  if (manifest.state !== "open") {
    throw new Error(
      `[mission.materialize] mission '${missionId}' is not open (state: ${manifest.state})`,
    );
  }

  const operationId = manifest.operationId;
  await acquireLock(
    workspaceRoot,
    `system:${manifest.systemId}`,
    operationId,
    "mission.materialize",
    "agent",
  );
  await acquireLock(
    workspaceRoot,
    `mission:${missionId}`,
    operationId,
    "mission.materialize",
    "agent",
  );

  try {
    return await runMissionMaterializeInternal(workspaceRoot, manifest, context, {
      reportOnly,
      skipPreflight,
      force,
    });
  } finally {
    await releaseLock(workspaceRoot, `mission:${missionId}`);
    await releaseLock(workspaceRoot, `system:${manifest.systemId}`);
  }
}
