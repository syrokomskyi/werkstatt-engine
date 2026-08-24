/*
<MODULE_CONTRACT>
<purpose>Facilitates Git operations for tracking file integrity and repository metadata.</purpose>
<non-goals>
  <item>Do not handle raw Git content parsing outside defined methods.</item>
  <item>Do not manage Git configuration or transport orchestration.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Tidied by compass.changesummary.tidy; see git history for prior entries.</item>
</CHANGE_SUMMARY>
*/

/**
 * Git operations for integrity tracking.
 * Provides file history, change detection, and repository metadata queries.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ChangedPaths, GitFileHistory } from "./types.ts";

const execFileAsync = promisify(execFile);

const DEFAULT_GIT_TIMEOUT_MS = 15_000;

interface RunGitOptions {
  timeoutMs?: number;
}

async function runGit(cwd: string, args: string[], options: RunGitOptions = {}): Promise<string> {
  const { timeoutMs = DEFAULT_GIT_TIMEOUT_MS } = options;
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    maxBuffer: 20 * 1024 * 1024,
    timeout: timeoutMs,
  });
  return stdout.trimEnd();
}

function uniqueSorted(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

export async function getTrackedFiles(cwd: string): Promise<string[]> {
  const output = await runGit(cwd, ["ls-files"]);
  return output ? output.split("\n").filter(Boolean) : [];
}

export async function getFileHistory(cwd: string, repoPath: string): Promise<GitFileHistory> {
  try {
    const latestOutput = await runGit(
      cwd,
      ["log", "--follow", "-1", "--format=%aI%x09%H", "--", repoPath],
      { timeoutMs: 10_000 },
    ).catch(() => "");

    const [updatedAtRaw, lastCommitShaRaw] = latestOutput.split("\t");

    const createdOutput = await runGit(
      cwd,
      ["log", "--follow", "--diff-filter=A", "--format=%aI", "--", repoPath],
      { timeoutMs: 5_000 },
    ).catch(() => "");

    const createdLines = createdOutput ? createdOutput.split("\n").filter(Boolean) : [];
    return {
      createdAt: createdLines.length ? createdLines[createdLines.length - 1] : null,
      updatedAt: updatedAtRaw || null,
      lastCommitSha: lastCommitShaRaw || null,
    };
  } catch {
    return { createdAt: null, updatedAt: null, lastCommitSha: null };
  }
}

export async function getFileRevisionFromHistory(cwd: string, repoPath: string): Promise<number> {
  try {
    const output = await runGit(
      cwd,
      ["log", "--follow", "--diff-filter=AMT", "--format=%H", "--", repoPath],
      { timeoutMs: 15_000 },
    ).catch(() => "");

    if (!output) {
      return 1;
    }

    const revisions = output.split("\n").filter(Boolean).length;
    return Math.max(1, revisions);
  } catch {
    return 1;
  }
}

function parseNameStatus(output: string): ChangedPaths {
  const added = new Set<string>();
  const modified = new Set<string>();
  const deleted = new Set<string>();
  const renamed: Array<{ from: string; to: string }> = [];

  for (const line of output.split("\n").filter(Boolean)) {
    const parts = line.split("\t");
    const status = parts[0] ?? "";
    if (status.startsWith("R") && parts[1] && parts[2]) {
      renamed.push({ from: parts[1], to: parts[2] });
      continue;
    }
    if (status === "A" && parts[1]) added.add(parts[1]);
    if ((status === "M" || status === "T") && parts[1]) modified.add(parts[1]);
    if (status === "D" && parts[1]) deleted.add(parts[1]);
  }

  return {
    added: uniqueSorted(added),
    modified: uniqueSorted(modified),
    deleted: uniqueSorted(deleted),
    renamed,
  };
}

function parsePorcelainStatus(output: string): ChangedPaths {
  const added = new Set<string>();
  const modified = new Set<string>();
  const deleted = new Set<string>();
  const renamed: Array<{ from: string; to: string }> = [];

  for (const line of output.split("\n").filter(Boolean)) {
    if (line.startsWith("?? ")) {
      added.add(line.slice(3).trim());
      continue;
    }

    const status = line.slice(0, 2);
    const body = line.slice(3).trim();

    if (body.includes(" -> ") && (status.includes("R") || status.includes("C"))) {
      const [from, to] = body.split(" -> ");
      if (from && to) {
        renamed.push({ from, to });
      }
      continue;
    }

    if (status.includes("D")) {
      deleted.add(body);
      continue;
    }
    if (status.includes("A")) {
      added.add(body);
      continue;
    }
    if (status.includes("M") || status.includes("T")) {
      modified.add(body);
    }
  }

  return {
    added: uniqueSorted(added),
    modified: uniqueSorted(modified),
    deleted: uniqueSorted(deleted),
    renamed,
  };
}

function hasAnyChanges(changes: ChangedPaths): boolean {
  return Boolean(
    changes.added.length ||
    changes.modified.length ||
    changes.deleted.length ||
    changes.renamed.length,
  );
}

export async function getChangedPaths(cwd: string, baseRef?: string): Promise<ChangedPaths> {
  try {
    if (baseRef) {
      const output = await runGit(
        cwd,
        ["diff", "--name-status", "--find-renames", `${baseRef}...HEAD`],
        { timeoutMs: 10_000 },
      );
      return parseNameStatus(output);
    }

    const output = await runGit(cwd, ["status", "--porcelain=1", "--untracked-files=normal"], {
      timeoutMs: 10_000,
    });
    const workingTreeChanges = parsePorcelainStatus(output);
    if (hasAnyChanges(workingTreeChanges)) {
      return workingTreeChanges;
    }

    const headDiff = await runGit(
      cwd,
      ["diff-tree", "--no-commit-id", "--name-status", "--find-renames", "-r", "HEAD"],
      { timeoutMs: 10_000 },
    ).catch(() => "");

    if (!headDiff) {
      return workingTreeChanges;
    }

    return parseNameStatus(headDiff);
  } catch {
    return { added: [], modified: [], deleted: [], renamed: [] };
  }
}

export async function getRepoUrl(cwd: string): Promise<string | null> {
  try {
    const output = await runGit(cwd, ["config", "--get", "remote.origin.url"], {
      timeoutMs: 5_000,
    });
    return output || null;
  } catch {
    return null;
  }
}

export async function getHeadSha(cwd: string): Promise<string | null> {
  try {
    const output = await runGit(cwd, ["rev-parse", "HEAD"], { timeoutMs: 5_000 });
    return output || null;
  } catch {
    return null;
  }
}
