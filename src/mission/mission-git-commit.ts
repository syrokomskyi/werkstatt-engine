/*
<MODULE_CONTRACT>
<purpose>RFC-0480: mission.git.commit — canonical operator edit commit command for mission workpiece. RFC-0594: runs targeted content validators based on changed file paths before committing.</purpose>
<non-goals>
  <item>Does not reconcile — use mission.reconcile for that.</item>
  <item>Does not run full mission.validate — use mission.validate for that. Pre-commit validators are a targeted subset, not a full validation.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1189: material.credits.public-text.validate joins the commit gate — unscoped over src/content/prose/ and src/content/site/ so generated-credits public-text leaks fail at commit time</item>
  <item>RFC-1199: fail-closed materialization preflight — MATERIALIZATION_IN_PROGRESS result when workpiece/.git/MATERIALIZATION-IN-PROGRESS exists or manifest.materializedAt is null; runs before the .git check, staging, and commit-gate validators</item>
  <item>RFC-1204: trigger effects.contract.validate unscoped on pages/prose staging</item>
  <item>RFC-1249: wire werkstatt.commands.validate into packages.check + retire CMD-OUTPUT debt</item>
  <item>RFC-1254: drop unused io-migration leftovers</item>
  <history>ADR-0096, ADR-0104, RFC-0480, RFC-0522, RFC-0560, RFC-0568, RFC-0594, RFC-0644, RFC-0797, RFC-0820, RFC-0878, RFC-1095, RFC-1149, RFC-1159, RFC-1160, RFC-1185, warpgogol-m000196</history>
</CHANGE_SUMMARY>
*/

import {
  createDefaultIO,
  execOrThrow,
  type WorkspaceIO,
} from "@warpgogol/werkstatt-shared/kernel/workspace-io";
import path from "node:path";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { executeKernelCommand } from "@warpgogol/werkstatt-engine/kernel";
import { runCompassSummaryRecord, stripConventionalPrefix } from "@warpgogol/forge/os/compass";
import { readMissionManifest, resolveMissionDir } from "./mission-io.ts";
import { MATERIALIZATION_SENTINEL } from "./mission-materialize.ts";
import { createSignedCommit } from "./signed-commit.ts";
import { readBordbuch } from "../bordbuch/bordbuch-io.ts";

export interface MissionGitCommitData {
  missionId: string;
  commitSha: string;
  message: string;
  committedAt: string;
  signed: boolean;
  actorId: string | null;
  signature: string | null;
  preCommitValidation?: PreCommitValidationResult;
  noChanges?: boolean;
}

export interface ValidatorMapping {
  prefix: string;
  validator: string;
  /** When true, runPreCommitValidation passes --scope-files with the changed files matching prefix. */
  scoped?: boolean;
}

export interface PreCommitValidationResult {
  passed: boolean;
  validatorsRun: string[];
  failures: Array<{
    validator: string;
    message: string;
    files: string[];
  }>;
}

export const VALIDATOR_MAPPINGS: ValidatorMapping[] = [
  { prefix: "src/content/business-profile/", validator: "pbp.content.validate" },
  // RFC-1160: block pinning — pages scoped, system.md unscoped (planets[] is whole-site)
  { prefix: "src/content/pages/", validator: "page.block.validate", scoped: true },
  { prefix: "src/content/system.md", validator: "page.block.validate" },
  { prefix: "src/content/pages/", validator: "semantic.drift.validate" },
  // RFC-1185: explicit inherit edges — collision groups are cross-page per
  // language, so the validator always runs unscoped (no --scope-files).
  { prefix: "src/content/pages/", validator: "shared.context.validate" },
  { prefix: "src/content/system.md", validator: "shared.context.validate" },
  { prefix: "src/content/faq/", validator: "faq.validate" },
  // RFC-1160: source-image budget — scoped to staged content assets
  { prefix: "src/content/", validator: "image.variants.validate", scoped: true },
  { prefix: "src/content/", validator: "typography.validate", scoped: true },
  // RFC-1189: public-text hygiene of generated credits.md — prose edits (the
  // generated page lives under prose/) and labels.md edits (partyKindLabels
  // is the kind-label source) trigger the read-only scan at commit time.
  { prefix: "src/content/prose/", validator: "material.credits.public-text.validate" },
  { prefix: "src/content/site/", validator: "material.credits.public-text.validate" },
  // RFC-1204: effect-signature parity (EFF-PARITY-01/02) is cross-page and
  // cross-locale, so staging any content file forces the unscoped run.
  { prefix: "src/content/pages/", validator: "effects.contract.validate" },
  { prefix: "src/content/prose/", validator: "effects.contract.validate" },
  // warpgogol-m000196: post-hero density rhythm — the check resolves
  // component-level density defaults from section sources, so it always runs
  // unscoped over all pages when any page file is staged.
  { prefix: "src/content/pages/", validator: "layout.rhythm.validate" },
];

function matchesPrefix(filePath: string, prefix: string): boolean {
  return filePath.startsWith(prefix);
}

export function selectValidators(changedFiles: string[]): string[] {
  const validators = new Set<string>();
  for (const file of changedFiles) {
    for (const mapping of VALIDATOR_MAPPINGS) {
      if (matchesPrefix(file, mapping.prefix)) {
        validators.add(mapping.validator);
      }
    }
  }
  return [...validators];
}

export async function runPreCommitValidation(
  changedFiles: string[],
  systemId: string,
  workspaceRoot: string,
): Promise<PreCommitValidationResult> {
  const validatorsToRun = selectValidators(changedFiles);
  if (validatorsToRun.length === 0) {
    return { passed: true, validatorsRun: [], failures: [] };
  }

  const failures: PreCommitValidationResult["failures"] = [];
  const validatorsRun: string[] = [];

  for (const validatorName of validatorsToRun) {
    // RFC-1160: per-validator scope resolution — any staged file matching a
    // non-scoped mapping forces an unscoped run (e.g. system.md planets[] must
    // re-check every page even when page files are also staged). Otherwise the
    // run is scoped to the union of files matching the validator's scoped prefixes.
    const mappings = VALIDATOR_MAPPINGS.filter((m) => m.validator === validatorName);
    const unscopedMatch = mappings.some(
      (m) => m.scoped !== true && changedFiles.some((f) => matchesPrefix(f, m.prefix)),
    );
    const scopedFiles = unscopedMatch
      ? []
      : changedFiles.filter((f) =>
          mappings.some((m) => m.scoped === true && matchesPrefix(f, m.prefix)),
        );
    const argv =
      !unscopedMatch && scopedFiles.length > 0
        ? ["--scope-files", scopedFiles.join(",")]
        : undefined;
    try {
      const execResult = await executeKernelCommand({
        workspaceRoot,
        commandName: validatorName,
        siteName: systemId,
        siteExplicit: true,
        argv,
      });
      const single = Array.isArray(execResult) ? execResult[0] : execResult;
      const ok = single?.ok ?? false;
      const exitCode = single?.exitCode ?? 1;
      const summary = single?.summary ?? "";
      validatorsRun.push(validatorName);

      if (!ok || exitCode !== 0) {
        failures.push({
          validator: validatorName,
          message: summary || `validator exited with code ${exitCode}`,
          files: changedFiles.filter((f) =>
            VALIDATOR_MAPPINGS.some(
              (m) => m.validator === validatorName && matchesPrefix(f, m.prefix),
            ),
          ),
        });
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes("not registered") || errMsg.includes("not found")) {
        process.stderr.write(
          `[warn] [mission.git.commit] validator '${validatorName}' is not registered — skipping.
`,
        );
        continue;
      }
      failures.push({
        validator: validatorName,
        message: `validator crashed: ${errMsg}`,
        files: changedFiles.filter((f) =>
          VALIDATOR_MAPPINGS.some(
            (m) => m.validator === validatorName && matchesPrefix(f, m.prefix),
          ),
        ),
      });
      validatorsRun.push(validatorName);
    }
  }

  return {
    passed: failures.length === 0,
    validatorsRun,
    failures,
  };
}

export interface WorkpieceDirtyResult {
  dirty: boolean;
  fileCount: number;
  files: string[];
}

export interface UntrackedFileReport {
  path: string;
  createdAt: string;
  sizeBytes: number;
  likelyOrigin: "previous-mission" | "direct-commit" | "unknown";
  originHint?: string;
}

const BOILERPLATE_PATTERNS = [
  /^\.github\/workflows\/deploy-.*\.yml$/,
  /^package\.json$/,
  /^astro\.config\.mjs$/,
  /^wrangler\.jsonc$/,
  /^tsconfig\.json$/,
  /^\.gitignore$/,
  /^postcss\.config\.cjs$/,
  /^\.env\.example$/,
  /^src\/routes\/.*\.astro$/,
  /^src\/pages\/.*\.astro$/,
];

function matchesBoilerplatePattern(filePath: string): boolean {
  return BOILERPLATE_PATTERNS.some((p) => p.test(filePath));
}

export async function investigateUntrackedFiles(
  workspaceRoot: string,
  systemId: string,
  systemDir: string,
  files: string[],
): Promise<UntrackedFileReport[]> {
  const bordbuchEntries = await readBordbuch(workspaceRoot, systemId);
  const missionOpenEntries = bordbuchEntries.filter((e) => e.kind === "mission-open");
  const missionTimeRanges = missionOpenEntries.map((e, i) => {
    const next = missionOpenEntries[i + 1];
    return { start: e.occurredAt, end: next ? next.occurredAt : new Date().toISOString() };
  });

  const reports: UntrackedFileReport[] = [];
  for (const file of files) {
    const fullPath = path.join(systemDir, file);
    let createdAt = "unknown";
    let sizeBytes = 0;
    try {
      const stat = await createDefaultIO().io.stat(fullPath);
      createdAt = new Date(stat.mtimeMs).toISOString();
      sizeBytes = stat.size;
    } catch {
      // File may have been removed between detection and investigation
    }

    const isBoilerplate = matchesBoilerplatePattern(file);
    const inMissionRange = missionTimeRanges.some(
      (r) => createdAt !== "unknown" && createdAt >= r.start && createdAt <= r.end,
    );

    let likelyOrigin: UntrackedFileReport["likelyOrigin"];
    let originHint: string | undefined;

    if (isBoilerplate && inMissionRange) {
      const matchingRange = missionTimeRanges.find(
        (r) => createdAt !== "unknown" && createdAt >= r.start && createdAt <= r.end,
      );
      likelyOrigin = "previous-mission";
      originHint = matchingRange
        ? `file matches boilerplate pattern and was created during a mission starting at ${matchingRange.start}`
        : undefined;
    } else if (!isBoilerplate && !inMissionRange) {
      likelyOrigin = "direct-commit";
      originHint =
        "file does not match boilerplate patterns and was not created during a known mission";
    } else {
      likelyOrigin = "unknown";
    }

    reports.push({ path: file, createdAt, sizeBytes, likelyOrigin, originHint });
  }
  return reports;
}

export interface OperatorCommitsResult {
  hasOperatorCommits: boolean;
  commitCount: number;
  commits: string[];
}

export async function countOperatorCommits(
  workpieceDir: string,
  migratedAt: string | null,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<OperatorCommitsResult> {
  if (!(await io.exists(path.join(workpieceDir, ".git")))) {
    return { hasOperatorCommits: false, commitCount: 0, commits: [] };
  }

  const rootResult = await io.exec("git", ["rev-list", "--max-parents=0", "HEAD"], {
    cwd: workpieceDir,
  });
  if (rootResult.exitCode !== 0) {
    return { hasOperatorCommits: false, commitCount: 0, commits: [] };
  }
  const rootSha = rootResult.stdout.trim();

  const listResult = await io.exec("git", ["rev-list", `${rootSha}..HEAD`, "--oneline"], {
    cwd: workpieceDir,
  });
  if (listResult.exitCode !== 0) {
    return { hasOperatorCommits: false, commitCount: 0, commits: [] };
  }
  const output = listResult.stdout.trim();

  const allCommits = output ? output.split("\n") : [];
  const baselineCount = migratedAt ? 1 : 0;
  const operatorCommits = allCommits.slice(baselineCount);

  return {
    hasOperatorCommits: operatorCommits.length > 0,
    commitCount: operatorCommits.length,
    commits: operatorCommits,
  };
}

export interface WorkpieceCommitResult {
  committed: boolean;
  commitSha: string | null;
}

async function commitDirIfDirty(
  dir: string,
  commitMessage: string,
  io: WorkspaceIO,
): Promise<WorkpieceCommitResult> {
  const dirtyCheck = await isWorkpieceDirty(dir, io);
  if (!dirtyCheck.dirty) {
    return { committed: false, commitSha: null };
  }

  await execOrThrow(io, "git", ["add", "-A"], { cwd: dir });

  await execOrThrow(io, "git", ["commit", "--no-verify", "-m", commitMessage], { cwd: dir });

  const shaResult = await execOrThrow(io, "git", ["rev-parse", "HEAD"], { cwd: dir });
  const commitSha = shaResult.stdout.trim();

  return { committed: true, commitSha };
}

export async function commitWorkpieceIfDirty(
  workpieceDir: string,
  missionId: string,
  message?: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<WorkpieceCommitResult> {
  // RFC-0878: Defence-in-depth — refuse to commit if .closed sentinel exists.
  // commitDirIfDirty uses --no-verify which bypasses the pre-commit hook.
  if (await io.exists(path.join(workpieceDir, ".closed"))) {
    throw new Error(
      `[commitWorkpieceIfDirty] workpiece is closed (RFC-0878) — mission '${missionId}' has a .closed sentinel file. No commits are allowed in a closed workpiece.`,
    );
  }
  const commitMessage = message ?? `workpiece: auto-commit before reconcile ${missionId}`;
  return commitDirIfDirty(workpieceDir, commitMessage, io);
}

export async function commitCacheCloneIfDirty(
  systemDir: string,
  systemId: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<WorkpieceCommitResult> {
  return commitDirIfDirty(
    systemDir,
    `cache-clone: auto-commit generated files before reconcile ${systemId}`,
    io,
  );
}

/**
 * Centralized cache-clone git commit helper (RFC-0821).
 *
 * Always passes MISSION_GIT_COMMIT=1 to bypass the cache-clone pre-commit hook.
 * Use this instead of raw execSync("git commit ...") or await gitExec(..., "commit ...")
 * when committing to a Sternsystem cache clone.
 *
 * @param systemDir - cache clone directory path
 * @param message - commit message
 * @param options.noEdit - use --no-edit (for merge commits)
 */
export async function cacheCloneCommit(
  systemDir: string,
  message: string,
  options?: { noEdit?: boolean },
  io: WorkspaceIO = createDefaultIO().io,
): Promise<string> {
  const commitArgs = options?.noEdit ? ["--no-edit"] : ["-m", message];
  const result = await io.exec("git", ["commit", ...commitArgs], {
    cwd: systemDir,
    env: { MISSION_GIT_COMMIT: "1" },
  });
  if (result.exitCode !== 0) {
    throw new Error(`git commit failed (exit ${result.exitCode}): ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

export async function isWorkpieceDirty(
  workpieceDir: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<WorkpieceDirtyResult> {
  if (!(await io.exists(path.join(workpieceDir, ".git")))) {
    return { dirty: false, fileCount: 0, files: [] };
  }
  const statusResult = await io.exec("git", ["status", "--porcelain"], {
    cwd: workpieceDir,
  });
  if (statusResult.exitCode !== 0) {
    return { dirty: false, fileCount: 0, files: [] };
  }
  // Use raw stdout (not trimmed) — leading spaces in " M file.txt" matter for slice(3).
  const lines = statusResult.stdout.split("\n").filter((l) => l.trim().length > 0);
  // Filter out files that match a .gitignore pattern even if still tracked.
  // This prevents mission.close from blocking on generated files like
  // derived-prices.generated.json that are gitignored but still tracked.
  const files: string[] = [];
  for (const line of lines) {
    const file = line.slice(3).trim();
    const ignoreResult = await io.exec("git", ["check-ignore", "--no-index", "--", file], {
      cwd: workpieceDir,
    });
    // exit 0 → file matches a .gitignore pattern → skip
    if (ignoreResult.exitCode !== 0) files.push(file);
  }
  return { dirty: files.length > 0, fileCount: files.length, files };
}

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

async function git(cwd: string, args: string[], io: WorkspaceIO): Promise<string> {
  const result = await io.exec("git", args, {
    cwd,
    env: { MISSION_GIT_COMMIT: "1" },
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `git ${args[0] ?? ""} failed (exit ${result.exitCode}): ${result.stderr.trim()}`,
    );
  }
  return result.stdout.trim();
}

export async function runMissionGitCommit(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<MissionGitCommitData>> {
  const { workspaceRoot } = context;
  const missionId = flagString(input, "mission");
  const message = flagString(input, "message");
  const rfcId = flagString(input, "rfc");
  const adrId = flagString(input, "adr");
  // ADR-0096: --scope-files restricts staging and validation to the listed
  // workpiece-relative paths — bookkeeping commits (e.g. snapshot bootstrap)
  // must not sweep or be blocked by unrelated dirty content.
  const scopeFilesCsv = flagString(input, "scope-files");
  const scopeFiles = scopeFilesCsv
    ? scopeFilesCsv
        .split(",")
        .map((f) => f.trim())
        .filter(Boolean)
    : undefined;

  if (!missionId) throw new Error("[mission.git.commit] --mission is required");
  if (!message) throw new Error("[mission.git.commit] --message is required");

  const manifest = await readMissionManifest(workspaceRoot, missionId);

  if (manifest.state !== "open") {
    throw new Error(
      `[mission.git.commit] mission '${missionId}' is not open (state: ${manifest.state})`,
    );
  }

  const missionDir = await resolveMissionDir(workspaceRoot, missionId, context.io);
  const workpieceDir = path.join(missionDir, "workpiece");

  if (!(await context.io.exists(workpieceDir))) {
    throw new Error(
      `[mission.git.commit] workpiece not found for mission '${missionId}' — run mission.materialize first`,
    );
  }

  // RFC-1199: fail closed while materialization is in flight. The sentinel
  // marks the window precisely (workpiece/.git exists, baseline commit not yet
  // landed); manifest.materializedAt == null is the fallback for a crashed
  // run that lost the sentinel or never reached git-init-commit — mission.open
  // auto-materializes (RFC-0951), so an open mission with materializedAt unset
  // is always mid-materialization. Runs before the .git check so the named
  // error is uniform, including the repo-less fallback window.
  const sentinelPath = path.join(workpieceDir, ".git", MATERIALIZATION_SENTINEL);
  if ((await context.io.exists(sentinelPath)) || manifest.materializedAt == null) {
    return {
      exitCode: 1,
      summary:
        `[mission.git.commit] MATERIALIZATION_IN_PROGRESS: workpiece for '${missionId}' ` +
        `is still being materialized — the pipeline has not created the baseline commit yet`,
      nextSteps: [
        {
          action:
            `Wait for mission.materialize to finish; if the operation failed, ` +
            `run mission.resume --mission ${missionId}`,
          kind: "required",
        },
      ],
    };
  }

  if (!(await context.io.exists(path.join(workpieceDir, ".git")))) {
    throw new Error(
      `[mission.git.commit] workpiece is not a git repository — run mission.materialize first`,
    );
  }

  // Stage changes: all when unscoped, only listed paths when --scope-files.
  if (scopeFiles && scopeFiles.length > 0) {
    await git(workpieceDir, ["add", "--", ...scopeFiles], context.io);
  } else {
    await git(workpieceDir, ["add", "-A"], context.io);
  }

  // Check if there are changes to commit. ADR-0104: scoped commits use
  // `git commit --only`, which takes the named paths' worktree state — so
  // "changes" means worktree-vs-HEAD inside the scope, not the whole index.
  let hasChanges: boolean;
  try {
    await git(
      workpieceDir,
      scopeFiles?.length
        ? ["diff", "--quiet", "HEAD", "--", ...scopeFiles]
        : ["diff", "--cached", "--quiet"],
      context.io,
    );
    hasChanges = false;
  } catch {
    hasChanges = true;
  }

  if (!hasChanges) {
    process.stderr.write(
      `[mission.git.commit] WARNING: No changes to commit for mission '${missionId}'.\n` +
        `  Brief: "${manifest.brief}"\n` +
        `  If you expected changes, verify your edits were actually written to disk.\n` +
        `  This is the most common cause of silent mission loss — work reported as done but never persisted.\n`,
    );
    const data: MissionGitCommitData = {
      missionId,
      commitSha: await git(workpieceDir, ["rev-parse", "HEAD"], context.io),
      message: "(no changes — workpiece is clean)",
      committedAt: new Date().toISOString(),
      signed: false,
      actorId: null,
      signature: null,
      noChanges: true,
    };
    return {
      data,
      exitCode: 0,
      summary: `[mission.git.commit] ${missionId} no changes to commit`,
    };
  }

  // RFC-1095: record CHANGE_SUMMARY items when the commit carries a governance
  // ID. Runs after staging, before validation and commit; non-fatal — a header
  // miss never blocks a commit, the next compass.validate surfaces the gap.
  // ADR-0104: a scoped commit validates exactly the files it will commit —
  // index residue outside the scope can neither be swept in nor block it.
  const stagedFiles = (
    await git(
      workpieceDir,
      scopeFiles?.length
        ? ["diff", "--cached", "--name-only", "--", ...scopeFiles]
        : ["diff", "--cached", "--name-only"],
      context.io,
    )
  )
    .split("\n")
    .filter(Boolean);

  const governanceId = rfcId ?? adrId;
  if (governanceId) {
    try {
      const recordResult = await runCompassSummaryRecord(
        {
          argv: [],
          flags: {
            id: governanceId,
            files: stagedFiles,
            text: stripConventionalPrefix(message),
            workpiece: workpieceDir,
          },
        },
        context,
      );
      const recorded = recordResult.data?.recorded ?? [];
      if (recorded.length > 0) {
        // Array form — no shell: filenames with $(...) or quotes cannot inject.
        await execOrThrow(context.io, "git", ["add", ...recorded], {
          cwd: workpieceDir,
          env: { MISSION_GIT_COMMIT: "1" },
        });
      }
      for (const reminder of recordResult.data?.keyDecisionsReminders ?? []) {
        process.stderr.write(`[mission.git.commit] review KEY_DECISIONS in ${reminder}\n`);
      }
    } catch (err) {
      process.stderr.write(
        `[mission.git.commit] compass.summary.record failed (non-fatal): ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }

  // RFC-1095: governance trailer matching ecosystem.commit's X-RFC convention.
  const commitMessage = governanceId
    ? `${message}\n\n${rfcId ? `X-RFC: ${rfcId}` : `X-ADR: ${adrId}`}`
    : message;

  // RFC-0594 + ADR-0096: run targeted content validators on the staged file
  // set — scoped commits validate only what they actually commit, so unrelated
  // dirty files can neither be swept in nor block a bookkeeping commit.
  const preCommitValidation = await runPreCommitValidation(
    stagedFiles,
    manifest.systemId,
    workspaceRoot,
  );

  if (!preCommitValidation.passed) {
    const failureLines = preCommitValidation.failures
      .map((f) => `  ${f.validator}: ${f.message}`)
      .join("\n");
    process.stderr.write(`[mission.git.commit] pre-commit validation failed:\n${failureLines}\n`);
    return {
      exitCode: 1,
      data: {
        missionId,
        commitSha: "",
        message,
        committedAt: new Date().toISOString(),
        signed: false,
        actorId: null,
        signature: null,
        preCommitValidation,
      },
      summary: `[mission.git.commit] ${missionId} pre-commit validation failed — fix issues before committing`,
      nextSteps: [
        {
          action: `Fix the validation failures above, then re-run: pnpm exec werkstatt run mission.git.commit --mission ${missionId} --message "<msg>"`,
          kind: "required",
        },
      ],
    };
  }

  const signingKey = process.env["WERKSTATT_OPERATOR_SIGNING_KEY"];
  const actorId = manifest.openedBy ?? "unknown";

  if (signingKey) {
    const result = await createSignedCommit(
      workpieceDir,
      commitMessage,
      actorId,
      signingKey,
      scopeFiles,
    );

    const data: MissionGitCommitData = {
      missionId,
      commitSha: result.commitSha,
      message,
      committedAt: new Date().toISOString(),
      signed: result.signed,
      actorId: result.actorId,
      signature: result.signature,
      preCommitValidation,
    };

    return {
      data,
      exitCode: 0,
      summary: result.signed
        ? `[mission.git.commit] ${missionId} signed commit: ${result.commitSha.slice(0, 12)}`
        : `[mission.git.commit] ${missionId} committed: ${result.commitSha.slice(0, 12)}`,
    };
  }

  // No signing key — produce unsigned commit
  process.stderr.write(
    `[warn] WERKSTATT_OPERATOR_SIGNING_KEY not set — producing unsigned commit.\n`,
  );

  const commitSha = await git(
    workpieceDir,
    scopeFiles?.length
      ? ["commit", "--only", "-m", commitMessage, "--", ...scopeFiles]
      : ["commit", "-m", commitMessage],
    context.io,
  );

  const data: MissionGitCommitData = {
    missionId,
    commitSha,
    message,
    committedAt: new Date().toISOString(),
    signed: false,
    actorId: null,
    signature: null,
    preCommitValidation,
  };

  return {
    data,
    exitCode: 0,
    summary: `[mission.git.commit] ${missionId} committed: ${commitSha.slice(0, 12)}`,
    nextSteps: [
      {
        action: `Validate the mission: pnpm exec werkstatt run mission.validate --mission ${missionId}`,
        kind: "optional",
      },
    ],
  };
}
