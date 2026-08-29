/*
<MODULE_CONTRACT>
  <purpose>
    Regression test for stash cleanup in commitAndPushBordbuch.
    Verifies that stashes are dropped after failed stash pop and on push failure,
    preventing stale stash accumulation in cache clones.
  </purpose>
  <keywords>stash, cleanup, bordbuch, commitAndPushBordbuch</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Initial: regression test for stash drop after failed pop and on push failure.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const gitCalls = vi.hoisted(() => ({
  calls: [] as string[],
  failOnPop: false,
  failOnPush: false,
}));

vi.mock("../werkstatt/git-exec.ts", () => ({
  gitExec: vi.fn((cwd: string, args: string) => {
    gitCalls.calls.push(args);
    if (args === "stash pop" && gitCalls.failOnPop) {
      throw new Error("stash pop conflict");
    }
    if (args.startsWith("push") && args.includes("origin") && gitCalls.failOnPush) {
      throw new Error("push failed");
    }
    if (args === "symbolic-ref --short HEAD") return "master";
    if (args === "rev-parse HEAD") return "abc123";
    return "";
  }),
}));

vi.mock("../mission/mission-git-commit.ts", () => ({
  cacheCloneCommit: vi.fn(),
}));

import { commitAndPushBordbuch } from "./bordbuch-io.ts";

let testRoot: string;
let systemDir: string;

beforeEach(async () => {
  testRoot = await mkdtemp(join(tmpdir(), "stash-cleanup-test-"));
  systemDir = join(testRoot, "cache-clone");
  await mkdir(systemDir, { recursive: true });
  await mkdir(join(systemDir, "bordbuch"), { recursive: true });
  await writeFile(join(systemDir, "bordbuch", "events.ndjson"), "");
  gitCalls.calls = [];
  gitCalls.failOnPop = false;
  gitCalls.failOnPush = false;
});

afterEach(async () => {
  await rm(testRoot, { recursive: true, force: true });
});

test("drops stash after failed stash pop", async () => {
  gitCalls.failOnPop = true;

  const result = await commitAndPushBordbuch(systemDir, "test commit");

  expect(gitCalls.calls).toContain("stash push -m bordbuch-pull-rebase");
  expect(gitCalls.calls).toContain("stash pop");
  expect(gitCalls.calls).toContain("stash drop");
  expect(result.pushed).toBe(true);
});

test("returns error on push failure after successful stash pop", async () => {
  gitCalls.failOnPush = true;

  const result = await commitAndPushBordbuch(systemDir, "test commit");

  expect(gitCalls.calls).toContain("stash push -m bordbuch-pull-rebase");
  expect(gitCalls.calls).toContain("stash pop");
  expect(result.pushed).toBe(false);
  expect(result.error).toContain("push failed");
});

const gitCallsNoStash = vi.hoisted(() => ({
  calls: [] as string[],
}));

test("no stash drop when nothing was stashed", async () => {
  vi.mocked(await import("../werkstatt/git-exec.ts")).gitExec.mockImplementationOnce(
    (cwd: string, args: string) => {
      gitCallsNoStash.calls.push(args);
      if (args === "stash push -m bordbuch-pull-rebase") {
        throw new Error("no changes to stash");
      }
      if (args === "symbolic-ref --short HEAD") return "master";
      if (args === "rev-parse HEAD") return "abc123";
      return "";
    },
  );

  const result = await commitAndPushBordbuch(systemDir, "test commit");

  // stash drop should NOT appear since nothing was stashed
  expect(gitCallsNoStash.calls).not.toContain("stash drop");
  expect(result.pushed).toBe(true);
});
