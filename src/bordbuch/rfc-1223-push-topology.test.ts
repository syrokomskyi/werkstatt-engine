/*
<MODULE_CONTRACT>
  <purpose>
    RFC-1223 regression tests for commitAndPushBordbuch divergence gating.
    Verifies that the push-preceding rebase only runs on real divergence:
    an ancestor remote must not trigger history-flattening rebase, a missing
    remote ref must push directly, and true divergence must integrate via
    rebase --rebase-merges so merge-commit topology is preserved.
  </purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Initial: RFC-1223 push-topology regression suite (ancestor/missing/diverged/conflict fixtures).</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { commitAndPushBordbuch } from "./bordbuch-io.ts";

const execFileAsync = promisify(execFile);

let root: string;
let remote: string;
let local: string;

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
}

async function gitMayFail(cwd: string, ...args: string[]): Promise<number> {
  try {
    await execFileAsync("git", args, { cwd });
    return 0;
  } catch {
    return 1;
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function commitFile(
  repo: string,
  file: string,
  content: string,
  message: string,
): Promise<string> {
  await writeFile(path.join(repo, file), content, "utf8");
  await git(repo, "add", file);
  await git(repo, "commit", "-m", message);
  return git(repo, "rev-parse", "HEAD");
}

async function configureUser(repo: string): Promise<void> {
  await git(repo, "config", "user.email", "test@warpgogol.dev");
  await git(repo, "config", "user.name", "test");
  await git(repo, "config", "commit.gpgsign", "false");
}

/** Seed a bare `remote` and a non-bare `local` clone at the same commit. */
async function initCloneFixture(): Promise<void> {
  remote = path.join(root, "remote.git");
  await git(root, "init", "--bare", remote);

  const seed = path.join(root, "seed");
  await git(root, "init", "-b", "main", seed);
  await configureUser(seed);
  await commitFile(seed, "f.txt", "base\n", "seed");
  await git(seed, "push", remote, "HEAD:main");

  local = path.join(root, "local");
  await git(root, "clone", "-b", "main", remote, local);
  await configureUser(local);
  await mkdir(path.join(local, "bordbuch"), { recursive: true });
}

/**
 * Add a merge commit ahead of origin/main on `local`: a side branch with one
 * commit folded back via `git merge --no-ff`, plus a bookkeeping commit on
 * main first so both parents carry unique history.
 */
async function addLocalMerge(): Promise<string> {
  await git(local, "checkout", "-b", "work");
  await commitFile(local, "w.txt", "work\n", "W1");
  await git(local, "checkout", "main");
  await commitFile(local, "b.txt", "bookkeeping\n", "B1");
  await git(local, "merge", "--no-ff", "-m", "merge work", "work");
  return git(local, "rev-parse", "HEAD");
}

async function pushBordbuch(): Promise<{
  commitSha: string | null;
  pushed: boolean;
  error: string | null;
}> {
  await writeFile(
    path.join(local, "bordbuch", "events.ndjson"),
    `${JSON.stringify({ id: "event-000001", kind: "mission-reconcile", summary: "test" })}\n`,
    "utf8",
  );
  return commitAndPushBordbuch(local, "Bordbuch: test");
}

async function remoteLog(format: string, ref = "main"): Promise<string> {
  return git(remote, "log", `--format=${format}`, ref);
}

async function remoteMergeShas(ref = "main"): Promise<string[]> {
  const out = await git(remote, "log", "--merges", "--format=%H", ref);
  return out.split("\n").filter((l) => l.trim());
}

async function localReflogSubjects(): Promise<string> {
  return git(local, "reflog", "--format=%gs");
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "rfc1223-push-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("ancestor remote skips pull and preserves merge topology", async () => {
  await initCloneFixture();
  await addLocalMerge();

  const result = await pushBordbuch();
  expect(result.error).toBeNull();
  expect(result.pushed).toBe(true);

  // No pull/rebase step ran: reflog carries no rebase or pull entries.
  expect(await localReflogSubjects()).not.toMatch(/rebase|pull/);
});

test("reconcile merge commit stays reachable in pushed history", async () => {
  await initCloneFixture();
  const mergeSha = await addLocalMerge();

  const result = await pushBordbuch();
  expect(result.pushed).toBe(true);

  const remoteMerges = await remoteMergeShas();
  expect(remoteMerges).toContain(mergeSha);
  expect(remoteMerges.length).toBeGreaterThan(0);
});

test("diverged remote rebases with merges preserved", async () => {
  await initCloneFixture();
  await addLocalMerge();

  // A second clone advances origin/main — real divergence.
  const other = path.join(root, "other");
  await git(root, "clone", "-b", "main", remote, other);
  await configureUser(other);
  await commitFile(other, "remote.txt", "remote side\n", "R1");
  await git(other, "push", "origin", "main");

  const result = await pushBordbuch();
  expect(result.error).toBeNull();
  expect(result.pushed).toBe(true);

  // A merge node survives in the pushed history (recreated by --rebase-merges),
  // and both sides' commits are present.
  const remoteMerges = await remoteMergeShas();
  expect(remoteMerges.length).toBeGreaterThan(0);
  const remoteSubjects = await remoteLog("%s", "main");
  expect(remoteSubjects).toContain("R1");
  expect(remoteSubjects).toContain("W1");
  expect(remoteSubjects).toContain("B1");
});

test("rebase conflict on divergence returns pushed false with error", async () => {
  await initCloneFixture();
  await commitFile(local, "f.txt", "local change\n", "local edit");

  const other = path.join(root, "other");
  await git(root, "clone", "-b", "main", remote, other);
  await configureUser(other);
  await commitFile(other, "f.txt", "remote change\n", "remote edit");
  await git(other, "push", "origin", "main");

  const result = await pushBordbuch();
  expect(result.pushed).toBe(false);
  expect(result.error).toBeTruthy();
});

test("rebase conflict leaves no rebase state directories", async () => {
  await initCloneFixture();
  await commitFile(local, "f.txt", "local change\n", "local edit");

  const other = path.join(root, "other");
  await git(root, "clone", "-b", "main", remote, other);
  await configureUser(other);
  await commitFile(other, "f.txt", "remote change\n", "remote edit");
  await git(other, "push", "origin", "main");

  await pushBordbuch();
  expect(await exists(path.join(local, ".git", "rebase-merge"))).toBe(false);
  expect(await exists(path.join(local, ".git", "rebase-apply"))).toBe(false);
});

test("rebase conflict preserves local commit as head", async () => {
  await initCloneFixture();
  await commitFile(local, "f.txt", "local change\n", "local edit");

  const other = path.join(root, "other");
  await git(root, "clone", "-b", "main", remote, other);
  await configureUser(other);
  await commitFile(other, "f.txt", "remote change\n", "remote edit");
  await git(other, "push", "origin", "main");

  const result = await pushBordbuch();
  expect(result.pushed).toBe(false);
  // rebase --abort restores HEAD to the pre-call bordbuch commit.
  expect(await git(local, "rev-parse", "HEAD")).toBe(result.commitSha);
});

test("recorded commitSha is an ancestor of pushed origin head", async () => {
  await initCloneFixture();
  await addLocalMerge();

  const result = await pushBordbuch();
  expect(result.pushed).toBe(true);
  expect(result.commitSha).toBeTruthy();
  expect(
    await gitMayFail(local, "merge-base", "--is-ancestor", result.commitSha!, "origin/main"),
  ).toBe(0);
});

test("missing remote ref skips rebase and pushes directly", async () => {
  remote = path.join(root, "remote.git");
  await git(root, "init", "--bare", remote);

  local = path.join(root, "local");
  await git(root, "init", "-b", "main", local);
  await configureUser(local);
  await git(local, "remote", "add", "origin", remote);
  await commitFile(local, "f.txt", "first\n", "initial");
  await mkdir(path.join(local, "bordbuch"), { recursive: true });

  const result = await pushBordbuch();
  expect(result.error).toBeNull();
  expect(result.pushed).toBe(true);
  expect(await localReflogSubjects()).not.toMatch(/rebase|pull/);

  const remoteHead = await git(remote, "rev-parse", "main");
  expect(remoteHead).toBe(result.commitSha);
});
