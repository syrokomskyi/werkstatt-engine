/*
<MODULE_CONTRACT>
  <purpose>RFC-0478: platform.consistency.validate — semantic hash drift guard and version bump enforcement.</purpose>
  <non-goals>
    <item>Does not bump package.json version — the operator does that in a separate commit.</item>
    <item>Does not validate migrator existence — that is RFC-0479's scope.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0478: initial platform.consistency.validate command handler.</item>
  <item>RFC-0533: add PC-04 rule — CI-side check for X-Platform-Bump trailers on platform-scope commits.</item>
</CHANGE_SUMMARY>
*/

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import fs from "node:fs/promises";
import path from "node:path";

import { parse as yamlParse, stringify as yamlStringify } from "yaml";

import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { resolvePlatformSemanticHash } from "./bundle-io.ts";
import { hasPlatformScopeFiles, hasTrailer } from "./platform-scope.ts";
import { compareSemver } from "./semver.ts";

export interface PlatformConsistencyData {
  currentHash: string;
  lastHash: string | null;
  currentVersion: string;
  lastVersion: string | null;
  driftDetected: boolean;
  validatedAt: string;
  violations?: PlatformConsistencyViolation[];
}

export interface PlatformConsistencyViolation {
  rule: "PC-01" | "PC-02" | "PC-03" | "PC-04";
  message: string;
  severity: "error" | "warning";
}

interface PlatformVersionLogEntry {
  hash: string;
  version: string;
  validatedAt: string;
}

function flagBoolean(input: KernelCommandInput, key: string): boolean {
  const v = input.flags[key];
  return typeof v === "boolean" ? v : false;
}

interface RfcVersionBumpMatch {
  versionBump: string | undefined;
  updatedAt: string;
}

async function findRfcsWithVersionBump(
  rfcDir: string,
  since: string,
  predicate: (vb: string) => boolean,
): Promise<RfcVersionBumpMatch[]> {
  const results: RfcVersionBumpMatch[] = [];
  try {
    const rfcFiles = await fs.readdir(rfcDir);
    for (const file of rfcFiles) {
      if (!file.endsWith(".md") || file.startsWith("rfc-0000")) continue;
      const filePath = path.join(rfcDir, file);
      const content = await fs.readFile(filePath, "utf-8");
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!fmMatch) continue;
      const fm = yamlParse(fmMatch[1]) as Record<string, unknown>;
      const vb = fm["versionBump"];
      const updatedAt = String(fm["updatedAt"] ?? "");
      if (typeof vb === "string" && predicate(vb) && updatedAt >= since) {
        results.push({ versionBump: vb, updatedAt });
      }
    }
  } catch {
    // RFC dir not readable — return empty
  }
  return results;
}

const execFileAsync = promisify(execFile);

/**
 * RFC-0533 PC-04: the commit SHA that introduced the PC-04 rule.
 * Commits before this SHA are exempt — the rule is not retroactive.
 * Updated to the actual implementation commit SHA when the RFC is stamped.
 */
export const PC_04_CUTOFF_SHA = "940c025cc";

interface GitLogCommit {
  sha: string;
  parents: string[];
  message: string;
  files: string[];
}

async function getGitLogSince(workspaceRoot: string, sinceSha: string): Promise<GitLogCommit[]> {
  try {
    // If cutoff is not a real SHA or doesn't exist in this repo, use the root commit
    let effectiveSince = sinceSha;
    if (sinceSha === "0000000" || sinceSha.length < 7) {
      try {
        const { stdout: rootSha } = await execFileAsync(
          "git",
          ["rev-list", "--max-parents=0", "HEAD"],
          { cwd: workspaceRoot },
        );
        effectiveSince = rootSha.trim();
      } catch {
        return [];
      }
    } else {
      // Verify the SHA exists in this repo
      try {
        await execFileAsync("git", ["cat-file", "-e", sinceSha], { cwd: workspaceRoot });
      } catch {
        // SHA doesn't exist — fall back to root commit
        try {
          const { stdout: rootSha } = await execFileAsync(
            "git",
            ["rev-list", "--max-parents=0", "HEAD"],
            { cwd: workspaceRoot },
          );
          effectiveSince = rootSha.trim();
        } catch {
          return [];
        }
      }
    }
    const { stdout } = await execFileAsync(
      "git",
      ["log", `${effectiveSince}..HEAD`, "--format=__COMMIT__%H%n%P%n%B%n__FILES__", "--name-only"],
      { cwd: workspaceRoot, maxBuffer: 10 * 1024 * 1024 },
    );
    const commits: GitLogCommit[] = [];
    const blocks = stdout.split("__COMMIT__");
    for (const block of blocks) {
      const trimmed = block.trim();
      if (!trimmed) continue;
      const lines = trimmed.split("\n");
      const sha = lines[0]?.trim();
      if (!sha) continue;
      const parentsStr = lines[1]?.trim() ?? "";
      const parents = parentsStr ? parentsStr.split(" ").filter(Boolean) : [];
      const filesStartIdx = lines.indexOf("__FILES__");
      const messageEnd = filesStartIdx >= 0 ? filesStartIdx : lines.length;
      const message = lines.slice(2, messageEnd).join("\n").trim();
      const files =
        filesStartIdx >= 0 ? lines.slice(filesStartIdx + 1).filter((l) => l.trim().length > 0) : [];
      commits.push({ sha, parents, message, files });
    }
    return commits;
  } catch {
    return [];
  }
}

async function checkPc04(workspaceRoot: string): Promise<PlatformConsistencyViolation[]> {
  const violations: PlatformConsistencyViolation[] = [];
  const commits = await getGitLogSince(workspaceRoot, PC_04_CUTOFF_SHA);
  for (const commit of commits) {
    // Skip merge commits (2+ parents)
    if (commit.parents.length >= 2) continue;
    // Skip commits with no platform-scope files
    if (!hasPlatformScopeFiles(commit.files)) continue;
    // Check for X-Platform-Bump trailer
    if (!hasTrailer(commit.message, "X-Platform-Bump")) {
      violations.push({
        rule: "PC-04",
        severity: "error",
        message: `Commit ${commit.sha.slice(0, 7)} touches platform scope but lacks X-Platform-Bump trailer. Use ecosystem.commit for platform-scope changes (RFC-0533).`,
      });
    }
  }
  return violations;
}

export async function runPlatformConsistencyValidate(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<PlatformConsistencyData>> {
  const { workspaceRoot } = context;
  const checkOnly = flagBoolean(input, "check");

  const logPath = path.join(workspaceRoot, "docs", "platform-version-log.generated.yaml");
  const packageJsonPath = path.join(workspaceRoot, "package.json");

  const currentHash = await resolvePlatformSemanticHash(workspaceRoot);

  let packageJson: { version?: string };
  try {
    packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf-8")) as { version?: string };
  } catch {
    throw new Error("[platform.consistency.validate] Could not read root package.json");
  }
  const currentVersion = packageJson.version ?? "0.0.0";

  let lastLog: PlatformVersionLogEntry | null = null;
  try {
    const logContent = await fs.readFile(logPath, "utf-8");
    lastLog = yamlParse(logContent) as PlatformVersionLogEntry;
  } catch {
    // first run — no log file
  }

  const lastHash = lastLog?.hash ?? null;
  const lastVersion = lastLog?.version ?? null;
  const validatedAt = new Date().toISOString();

  const violations: PlatformConsistencyViolation[] = [];

  const hashChanged = lastHash !== null && lastHash !== currentHash;
  const versionChanged = lastVersion !== null && compareSemver(currentVersion, lastVersion) !== 0;

  // PC-01: hash changed but version did not
  if (hashChanged && !versionChanged) {
    violations.push({
      rule: "PC-01",
      severity: "error",
      message: `platformSemanticHash changed (${lastHash} → ${currentHash}) but package.json version did not (${currentVersion}). Bump the version or declare versionBump: none in the relevant RFC.`,
    });
  }

  // PC-02: version bumped but no corresponding RFC with versionBump found
  if (versionChanged && lastVersion !== null) {
    const rfcDir = path.join(workspaceRoot, "docs", "rfcs");
    const since = lastLog?.validatedAt ?? "";
    const bumpRfcs = await findRfcsWithVersionBump(
      rfcDir,
      since,
      (vb) => vb === "minor" || vb === "patch",
    );
    if (bumpRfcs.length === 0) {
      violations.push({
        rule: "PC-02",
        severity: "warning",
        message: `package.json version bumped (${lastVersion} → ${currentVersion}) but no RFC with versionBump: minor|patch and updatedAt >= last validation was found.`,
      });
    }
  }

  // PC-03: versionBump: minor RFC merged but minor version was not bumped
  if (lastVersion !== null) {
    const minorBumped =
      compareSemver(currentVersion, lastVersion) >= 0 &&
      currentVersion.split(".")[1] !== lastVersion.split(".")[1];
    if (!minorBumped && versionChanged) {
      const rfcDir = path.join(workspaceRoot, "docs", "rfcs");
      const since = lastLog?.validatedAt ?? "";
      const minorRfcs = await findRfcsWithVersionBump(rfcDir, since, (vb) => vb === "minor");
      if (minorRfcs.length > 0) {
        violations.push({
          rule: "PC-03",
          severity: "error",
          message: `An RFC with versionBump: minor was merged but the minor version was not bumped (${lastVersion} → ${currentVersion}).`,
        });
      }
    }
  }

  // PC-04 (RFC-0533): commits touching platform scope after cutoff must carry X-Platform-Bump trailer
  const pc04Violations = await checkPc04(workspaceRoot);
  violations.push(...pc04Violations);

  const hasErrors = violations.some((v) => v.severity === "error");
  const driftDetected = hashChanged && !versionChanged;

  // Write log on success (unless --check mode). Covers both first-run and subsequent runs.
  if (!hasErrors && !checkOnly) {
    const logEntry: PlatformVersionLogEntry = {
      hash: currentHash,
      version: currentVersion,
      validatedAt,
    };
    const logYaml = yamlStringify(logEntry);
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    await fs.writeFile(logPath, logYaml, "utf-8");
  }

  const data: PlatformConsistencyData = {
    currentHash,
    lastHash,
    currentVersion,
    lastVersion,
    driftDetected,
    validatedAt,
    violations,
  };

  return {
    data,
    exitCode: hasErrors ? 1 : 0,
    summary: hasErrors
      ? `Platform consistency check failed with ${violations.filter((v) => v.severity === "error").length} error${violations.filter((v) => v.severity === "error").length === 1 ? "" : "s"}`
      : "Platform consistency check passed",
  };
}
