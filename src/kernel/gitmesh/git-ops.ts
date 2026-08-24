/*
<MODULE_CONTRACT>
<purpose>
RFC-0563: Low-level git operations for the git-mesh subsystem. Thin wrappers
around `git` CLI invocations using execFileSync. All functions are async-ready
via promisified execFile with a 6-minute timeout for network operations.
</purpose>
<non-goals>
  <item>Do not implement convergence logic — that lives in sync.ts.</item>
  <item>Do not implement command handlers — those live in sync.ts, status.ts, verify.ts.</item>
  <item>Do not implement config loading — that lives in config.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0563: initial implementation — git operations layer for git-mesh.</item>
</CHANGE_SUMMARY>
*/

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 360_000; // 6 minutes

export interface CommitInfo {
  sha: string;
  signatureStatus: string; // %G? value: G, B, U, X, Y, R, E, N
}

export interface RemoteInfo {
  name: string;
  url: string;
}

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout.trim();
}

export async function gitFetch(remote: string, branch: string, cwd: string): Promise<void> {
  await git(["fetch", remote, branch], cwd);
}

export async function gitMergeFfOnly(commitSha: string, cwd: string): Promise<void> {
  await git(["merge", "--ff-only", commitSha], cwd);
}

export async function gitFsck(cwd: string): Promise<boolean> {
  try {
    await git(["fsck", "--no-dangling"], cwd);
    return true;
  } catch {
    return false;
  }
}

export async function gitRevParseHead(cwd: string): Promise<string> {
  return git(["rev-parse", "HEAD"], cwd);
}

export async function gitRevParseRemote(
  remote: string,
  branch: string,
  cwd: string,
): Promise<string> {
  return git(["rev-parse", `refs/remotes/${remote}/${branch}`], cwd);
}

export async function gitCommitTimestamp(sha: string, cwd: string): Promise<number> {
  const output = await git(["log", "-1", "--format=%ct", sha], cwd);
  return parseInt(output, 10);
}

export async function gitIsAncestor(
  ancestor: string,
  descendant: string,
  cwd: string,
): Promise<boolean> {
  try {
    await git(["merge-base", "--is-ancestor", ancestor, descendant], cwd);
    return true;
  } catch {
    return false;
  }
}

export async function gitHasUncommittedChanges(cwd: string): Promise<boolean> {
  const output = await git(["status", "--porcelain"], cwd);
  return output.length > 0;
}

export async function gitRemoteList(cwd: string): Promise<RemoteInfo[]> {
  const output = await git(["remote", "-v"], cwd);
  const seen = new Set<string>();
  const remotes: RemoteInfo[] = [];

  for (const line of output.split("\n")) {
    const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/);
    if (!match) continue;
    const [, name, url] = match;
    const key = `${name}\x1f${url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    remotes.push({ name, url });
  }

  return remotes;
}

export async function gitRemoteAdd(name: string, url: string, cwd: string): Promise<void> {
  await git(["remote", "add", name, url], cwd);
}

export async function gitRemoteSetUrl(name: string, url: string, cwd: string): Promise<void> {
  await git(["remote", "set-url", name, url], cwd);
}

export async function gitRevListCount(
  fromSha: string,
  toSha: string,
  cwd: string,
): Promise<number> {
  const output = await git(["rev-list", "--count", `${fromSha}..${toSha}`], cwd);
  return parseInt(output, 10);
}

export async function gitLogSignatureStatus(range: string, cwd: string): Promise<CommitInfo[]> {
  const RECORD_SEP = "\x1e";
  const FIELD_SEP = "\x1f";
  const output = await git(["log", range, `--format=%H${FIELD_SEP}%G?${RECORD_SEP}`], cwd);

  return output
    .split(RECORD_SEP)
    .map((record) => record.trim())
    .filter((record) => record.length > 0)
    .map((record) => {
      const [sha = "", sigStatus = ""] = record.split(FIELD_SEP);
      return { sha, signatureStatus: sigStatus };
    });
}

export async function gitLogAll(range: string, cwd: string): Promise<CommitInfo[]> {
  return gitLogSignatureStatus(range, cwd);
}
