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
<KEY_DECISIONS>
  <item>Git operations are thin execFileSync wrappers — no git logic is reimplemented.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-0563: initial implementation — git operations layer for git-mesh.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
  <item>RFC-1149: migrate ambient filesystem and process IO to the WorkspaceIO port across engine and shared</item>
</CHANGE_SUMMARY>
*/

import { createDefaultIO, type WorkspaceIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";

const GIT_TIMEOUT_MS = 360_000; // 6 minutes

export interface CommitInfo {
  sha: string;
  signatureStatus: string; // %G? value: G, B, U, X, Y, R, E, N
}

export interface RemoteInfo {
  name: string;
  url: string;
}

async function git(args: string[], cwd: string, io: WorkspaceIO): Promise<string> {
  const result = await io.exec("git", args, { cwd, timeoutMs: GIT_TIMEOUT_MS });
  if (result.exitCode !== 0) {
    const err = new Error(
      `git ${args[0] ?? ""} failed (exit ${result.exitCode}): ${result.stderr.trim()}`,
    );
    (err as { stderr?: string }).stderr = result.stderr;
    throw err;
  }
  return result.stdout.trim();
}

export async function gitFetch(
  remote: string,
  branch: string,
  cwd: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<void> {
  await git(["fetch", remote, branch], cwd, io);
}

export async function gitMergeFfOnly(
  commitSha: string,
  cwd: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<void> {
  await git(["merge", "--ff-only", commitSha], cwd, io);
}

export async function gitFsck(
  cwd: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<boolean> {
  try {
    await git(["fsck", "--no-dangling"], cwd, io);
    return true;
  } catch {
    return false;
  }
}

export async function gitRevParseHead(
  cwd: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<string> {
  return git(["rev-parse", "HEAD"], cwd, io);
}

export async function gitRevParseRemote(
  remote: string,
  branch: string,
  cwd: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<string> {
  return git(["rev-parse", `refs/remotes/${remote}/${branch}`], cwd, io);
}

export async function gitCommitTimestamp(
  sha: string,
  cwd: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<number> {
  const output = await git(["log", "-1", "--format=%ct", sha], cwd, io);
  return parseInt(output, 10);
}

export async function gitIsAncestor(
  ancestor: string,
  descendant: string,
  cwd: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<boolean> {
  try {
    await git(["merge-base", "--is-ancestor", ancestor, descendant], cwd, io);
    return true;
  } catch {
    return false;
  }
}

export async function gitHasUncommittedChanges(
  cwd: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<boolean> {
  const output = await git(["status", "--porcelain"], cwd, io);
  return output.length > 0;
}

export async function gitRemoteList(
  cwd: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<RemoteInfo[]> {
  const output = await git(["remote", "-v"], cwd, io);
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

export async function gitRemoteAdd(
  name: string,
  url: string,
  cwd: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<void> {
  await git(["remote", "add", name, url], cwd, io);
}

export async function gitRemoteSetUrl(
  name: string,
  url: string,
  cwd: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<void> {
  await git(["remote", "set-url", name, url], cwd, io);
}

export async function gitRevListCount(
  fromSha: string,
  toSha: string,
  cwd: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<number> {
  const output = await git(["rev-list", "--count", `${fromSha}..${toSha}`], cwd, io);
  return parseInt(output, 10);
}

export async function gitLogSignatureStatus(
  range: string,
  cwd: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<CommitInfo[]> {
  const RECORD_SEP = "\x1e";
  const FIELD_SEP = "\x1f";
  const output = await git(["log", range, `--format=%H${FIELD_SEP}%G?${RECORD_SEP}`], cwd, io);

  return output
    .split(RECORD_SEP)
    .map((record) => record.trim())
    .filter((record) => record.length > 0)
    .map((record) => {
      const [sha = "", sigStatus = ""] = record.split(FIELD_SEP);
      return { sha, signatureStatus: sigStatus };
    });
}

export async function gitLogAll(
  range: string,
  cwd: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<CommitInfo[]> {
  return gitLogSignatureStatus(range, cwd, io);
}
