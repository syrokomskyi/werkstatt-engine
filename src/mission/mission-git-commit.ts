/*
<MODULE_CONTRACT>
<purpose>RFC-0480: mission.git.commit — canonical operator edit commit command for mission workpiece. RFC-0594: runs targeted content validators based on changed file paths before committing.</purpose>
<non-goals>
  <item>Does not reconcile — use mission.reconcile for that.</item>
  <item>Does not run full mission.validate — use mission.validate for that. Pre-commit validators are a targeted subset, not a full validation.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0480: initial mission.git.commit command handler.</item>
  <item>RFC-0480: add isWorkpieceDirty() shared helper for dirty workpiece guards.</item>
  <item>RFC-0522: extend WorkpieceDirtyResult with files[] for cache clone guard error messages.</item>
  <item>RFC-0560: integrate Ed25519 signed commits via createSignedCommit when PASSPORT_SIGNING_KEY is set.</item>
  <item>RFC-0568: add investigateUntrackedFiles helper and UntrackedFileReport type for cache clone untracked file origin analysis.</item>
  <item>RFC-0594: add pre-commit content validation via runPreCommitValidation based on changed file paths.</item>
  <item>RFC-0644: add commitWorkpieceIfDirty helper for auto-committing dirty workpiece before mission.reconcile.</item>
  <item>RFC-0797: add commitCacheCloneIfDirty helper for auto-committing all dirty files in cache clone before reconcile dirty guard.</item>
  <item>RFC-0820: add noChanges field to MissionGitCommitData and prominent stderr warning when no changes to commit.</item>
  <item>RFC-0878: add .closed sentinel check to commitWorkpieceIfDirty — refuse to commit closed workpieces (defence-in-depth, since --no-verify bypasses the hook).</item>
</CHANGE_SUMMARY>
*/

import { execSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { executeKernelCommand } from "@warpgogol/werkstatt-engine/kernel";
import { readMissionManifest, resolveMissionDir } from "./mission-io.ts";
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
  { prefix: "src/content/pages/", validator: "semantic.drift.validate" },
  { prefix: "src/content/faq/", validator: "faq.validate" },
];

function matchesPrefix(filePath: string, prefix: string): boolean {
  return filePath.startsWith(prefix);
}

function selectValidators(changedFiles: string[]): string[] {
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
    try {
      const execResult = await executeKernelCommand({
        workspaceRoot,
        commandName: validatorName,
        siteName: systemId,
        siteExplicit: true,
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
      const stat = statSync(fullPath);
      createdAt = stat.mtime.toISOString();
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

export function countOperatorCommits(
  workpieceDir: string,
  migratedAt: string | null,
): OperatorCommitsResult {
  if (!existsSync(path.join(workpieceDir, ".git"))) {
    return { hasOperatorCommits: false, commitCount: 0, commits: [] };
  }

  let rootSha: string;
  try {
    rootSha = execSync("git rev-list --max-parents=0 HEAD", {
      cwd: workpieceDir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return { hasOperatorCommits: false, commitCount: 0, commits: [] };
  }

  let output: string;
  try {
    output = execSync(`git rev-list ${rootSha}..HEAD --oneline`, {
      cwd: workpieceDir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return { hasOperatorCommits: false, commitCount: 0, commits: [] };
  }

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

function commitDirIfDirty(dir: string, commitMessage: string): WorkpieceCommitResult {
  const dirtyCheck = isWorkpieceDirty(dir);
  if (!dirtyCheck.dirty) {
    return { committed: false, commitSha: null };
  }

  execSync("git add -A", {
    cwd: dir,
    stdio: ["pipe", "pipe", "pipe"],
    encoding: "utf-8",
  });

  execSync(`git commit --no-verify -m ${JSON.stringify(commitMessage)}`, {
    cwd: dir,
    stdio: ["pipe", "pipe", "pipe"],
    encoding: "utf-8",
  });

  const commitSha = execSync("git rev-parse HEAD", {
    cwd: dir,
    stdio: ["pipe", "pipe", "pipe"],
    encoding: "utf-8",
  }).trim();

  return { committed: true, commitSha };
}

export function commitWorkpieceIfDirty(
  workpieceDir: string,
  missionId: string,
): WorkpieceCommitResult {
  // RFC-0878: Defence-in-depth — refuse to commit if .closed sentinel exists.
  // commitDirIfDirty uses --no-verify which bypasses the pre-commit hook.
  if (existsSync(path.join(workpieceDir, ".closed"))) {
    throw new Error(
      `[commitWorkpieceIfDirty] workpiece is closed (RFC-0878) — mission '${missionId}' has a .closed sentinel file. No commits are allowed in a closed workpiece.`,
    );
  }
  return commitDirIfDirty(workpieceDir, `workpiece: auto-commit before reconcile ${missionId}`);
}

export function commitCacheCloneIfDirty(
  systemDir: string,
  systemId: string,
): WorkpieceCommitResult {
  return commitDirIfDirty(
    systemDir,
    `cache-clone: auto-commit generated files before reconcile ${systemId}`,
  );
}

/**
 * Centralized cache-clone git commit helper (RFC-0821).
 *
 * Always passes MISSION_GIT_COMMIT=1 to bypass the cache-clone pre-commit hook.
 * Use this instead of raw execSync("git commit ...") or gitExec(..., "commit ...")
 * when committing to a Sternsystem cache clone.
 *
 * @param systemDir - cache clone directory path
 * @param message - commit message
 * @param options.noEdit - use --no-edit (for merge commits)
 */
export function cacheCloneCommit(
  systemDir: string,
  message: string,
  options?: { noEdit?: boolean },
): string {
  const commitArgs = options?.noEdit ? "--no-edit" : `-m ${JSON.stringify(message)}`;
  return execSync(`git commit ${commitArgs}`, {
    cwd: systemDir,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, MISSION_GIT_COMMIT: "1" },
  }).trim();
}

export function isWorkpieceDirty(workpieceDir: string): WorkpieceDirtyResult {
  if (!existsSync(path.join(workpieceDir, ".git"))) {
    return { dirty: false, fileCount: 0, files: [] };
  }
  let output: string;
  try {
    // Use execSync directly (not the git() helper) to avoid trimming leading spaces
    // in git status --porcelain output (e.g. " M file.txt" → "M file.txt" would break slice(3))
    output = execSync("git status --porcelain", {
      cwd: workpieceDir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    return { dirty: false, fileCount: 0, files: [] };
  }
  const lines = output.split("\n").filter((l) => l.trim().length > 0);
  // Filter out files that match a .gitignore pattern even if still tracked.
  // This prevents mission.close from blocking on generated files like
  // derived-prices.generated.json that are gitignored but still tracked.
  const files: string[] = [];
  for (const line of lines) {
    const file = line.slice(3).trim();
    try {
      execSync(`git check-ignore --no-index -- "${file}"`, {
        cwd: workpieceDir,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      // git check-ignore exits 0 → file matches a .gitignore pattern → skip
    } catch {
      // git check-ignore exits non-zero → file is NOT gitignored → include it
      files.push(file);
    }
  }
  return { dirty: files.length > 0, fileCount: files.length, files };
}

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

function git(cwd: string, args: string): string {
  return execSync(`git ${args}`, {
    cwd,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, MISSION_GIT_COMMIT: "1" },
  }).trim();
}

export async function runMissionGitCommit(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<MissionGitCommitData>> {
  const { workspaceRoot } = context;
  const missionId = flagString(input, "mission");
  const message = flagString(input, "message");

  if (!missionId) throw new Error("[mission.git.commit] --mission is required");
  if (!message) throw new Error("[mission.git.commit] --message is required");

  const manifest = await readMissionManifest(workspaceRoot, missionId);

  if (manifest.state !== "open") {
    throw new Error(
      `[mission.git.commit] mission '${missionId}' is not open (state: ${manifest.state})`,
    );
  }

  const missionDir = resolveMissionDir(workspaceRoot, missionId);
  const workpieceDir = path.join(missionDir, "workpiece");

  if (!existsSync(workpieceDir)) {
    throw new Error(
      `[mission.git.commit] workpiece not found for mission '${missionId}' — run mission.materialize first`,
    );
  }

  if (!existsSync(path.join(workpieceDir, ".git"))) {
    throw new Error(
      `[mission.git.commit] workpiece is not a git repository — run mission.materialize first`,
    );
  }

  // Stage all changes
  git(workpieceDir, "add -A");

  // Check if there are changes to commit
  let hasChanges: boolean;
  try {
    git(workpieceDir, "diff --cached --quiet");
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
      commitSha: git(workpieceDir, "rev-parse HEAD"),
      message: "(no changes — workpiece is clean)",
      committedAt: new Date().toISOString(),
      signed: false,
      actorId: null,
      signature: null,
      noChanges: true,
    };
    return {
      data,
      summary: `[mission.git.commit] ${missionId} no changes to commit`,
    };
  }

  // RFC-0594: run targeted content validators based on changed file paths
  const dirtyResult = isWorkpieceDirty(workpieceDir);
  const preCommitValidation = await runPreCommitValidation(
    dirtyResult.files,
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

  const signingKey = process.env["PASSPORT_SIGNING_KEY"];
  const actorId = manifest.openedBy ?? "unknown";

  if (signingKey) {
    const result = await createSignedCommit(workpieceDir, message, actorId, signingKey);

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
      summary: result.signed
        ? `[mission.git.commit] ${missionId} signed commit: ${result.commitSha.slice(0, 12)}`
        : `[mission.git.commit] ${missionId} committed: ${result.commitSha.slice(0, 12)}`,
    };
  }

  // No signing key — produce unsigned commit
  process.stderr.write(`[warn] PASSPORT_SIGNING_KEY not set — producing unsigned commit.\n`);

  const commitSha = git(workpieceDir, `commit -m ${JSON.stringify(message)}`);

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
    summary: `[mission.git.commit] ${missionId} committed: ${commitSha.slice(0, 12)}`,
    nextSteps: [
      {
        action: `Validate the mission: pnpm exec werkstatt run mission.validate --mission ${missionId}`,
        kind: "optional",
      },
    ],
  };
}
