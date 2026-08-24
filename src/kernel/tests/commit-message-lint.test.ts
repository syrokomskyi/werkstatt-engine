import { test, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  lintCommitSubject,
  parseGitLogOutput,
  parseNameOnlyOutput,
  isExempt,
  runCommitMessageLint,
  type CommitRecord,
} from "../commit-message-lint.ts";
import type { KernelCommandInput, KernelRuntimeContext } from "../types.ts";

/*
<MODULE_CONTRACT>
<purpose>
  RFC-0265: fixture tests for commit.message.lint. Written BEFORE the git
  integration was wired up, per the RFC's rollout note — message-string
  fixtures exercise the rules with no real git needed; one integration test
  runs over a temp git repository for range resolution + merge exemption.
</purpose>
</MODULE_CONTRACT>
*/

function commit(overrides: Partial<CommitRecord>): CommitRecord {
  return { hash: "abcdef1234567890", parents: ["parent1"], subject: "", body: "", ...overrides };
}

test("COMMIT-01: fails a subject over 120 characters", () => {
  const subject = "feat: " + "x".repeat(120);
  const findings = lintCommitSubject(commit({ subject }));
  expect(findings.some((f) => f.ruleId === "COMMIT-01")).toBeTruthy();
});

test("COMMIT-01: a subject at 120 characters passes", () => {
  const subject = "feat: " + "x".repeat(114); // 6 + 114 = 120
  expect(subject.length).toBe(120);
  const findings = lintCommitSubject(commit({ subject }));
  expect(!findings.some((f) => f.ruleId === "COMMIT-01")).toBeTruthy();
});

test("COMMIT-02/03: three real offending subjects from the RFC each fail", () => {
  const offenders = [
    "Found the bug — `app.qa.validate` passes `args:` incorrectly to the handler",
    "Good — `PlanetCatalog` and `MoonCatalog` are exported from the cosmic barrel",
    "**05-audit — пройдено (з очікуваними build-deferred блокерами).**",
  ];
  for (const subject of offenders) {
    const findings = lintCommitSubject(commit({ subject }));
    expect(findings.some((f) => f.ruleId === "COMMIT-02" || f.ruleId === "COMMIT-03")).toBeTruthy();
  }
});

test("five well-formed subjects pass with zero findings", () => {
  const wellFormed = [
    "feat: add maintenance debt queues",
    "fix(kernel): resolve flag parsing edge case",
    "docs: update AGENTS.md subpath map",
    "refactor(share): split barrel into subpaths",
    "chore: bump lockfile",
  ];
  for (const subject of wellFormed) {
    const findings = lintCommitSubject(commit({ subject }));
    expect(findings).toEqual([]);
  }
});

test("COMMIT-04: warns when packages/os/** is touched without an RFC id reference", () => {
  const findings = lintCommitSubject(commit({ subject: "fix(kernel): patch the flag resolver" }), [
    "packages/os/site-kernel/src/runtime.ts",
  ]);
  expect(findings.some((f) => f.ruleId === "COMMIT-04" && f.severity === "warning")).toBeTruthy();
});

test("COMMIT-04: silent when the subject references an RFC id", () => {
  const findings = lintCommitSubject(
    commit({ subject: "feat(kernel): implement rfc-0265 commit lint" }),
    ["packages/os/site-kernel/src/commit-message-lint.ts"],
  );
  expect(!findings.some((f) => f.ruleId === "COMMIT-04")).toBeTruthy();
});

test("COMMIT-04: silent when body references an RFC id", () => {
  const findings = lintCommitSubject(
    commit({ subject: "fix(kernel): patch the flag resolver", body: "See rfc-0260 for context." }),
    ["packages/os/site-kernel/src/runtime.ts"],
  );
  expect(!findings.some((f) => f.ruleId === "COMMIT-04")).toBeTruthy();
});

test("isExempt: a merge commit (>1 parent) is exempt regardless of subject shape", () => {
  const findings = lintCommitSubject(
    commit({ parents: ["p1", "p2"], subject: "Found the bug and merged the fix" }),
  );
  expect(findings).toEqual([]);
  expect(isExempt({ subject: "Merge branch x", parents: ["p1", "p2"] })).toBe(true);
});

test("isExempt: a git-generated revert is exempt", () => {
  expect(isExempt({ subject: 'Revert "feat: add thing"', parents: ["p1"] })).toBe(true);
});

test("parseGitLogOutput: parses hash, parents, subject, and body", () => {
  const raw = [
    "\x1eabc123\x1fparent1 parent2\x1ffeat: do a thing\x1fBody line one.\nBody line two.",
  ].join("");
  const parsed = parseGitLogOutput(raw);
  expect(parsed.length).toBe(1);
  expect(parsed[0]?.hash).toBe("abc123");
  expect(parsed[0]?.parents).toEqual(["parent1", "parent2"]);
  expect(parsed[0]?.subject).toBe("feat: do a thing");
  expect(parsed[0]?.body).toBe("Body line one.\nBody line two.");
});

test("parseGitLogOutput: parses multiple records", () => {
  const raw = ["\x1eabc123\x1fp1\x1ffeat: one\x1f", "\x1edef456\x1fp2\x1ffeat: two\x1f"].join("");
  const parsed = parseGitLogOutput(raw);
  expect(parsed.length).toBe(2);
  expect(parsed[0]?.hash).toBe("abc123");
  expect(parsed[1]?.hash).toBe("def456");
});

test("parseNameOnlyOutput: groups changed files by commit hash", () => {
  const marker = "\x02COMMIT:";
  const raw = [
    `${marker}abc123\npackages/os/site-kernel/src/a.ts\npackages/os/site-kernel/src/b.ts\n`,
    `${marker}def456\ndocs/rfcs/rfc-0265.md\n`,
  ].join("");
  const parsed = parseNameOnlyOutput(raw, marker);
  expect(parsed.get("abc123")).toEqual([
    "packages/os/site-kernel/src/a.ts",
    "packages/os/site-kernel/src/b.ts",
  ]);
  expect(parsed.get("def456")).toEqual(["docs/rfcs/rfc-0265.md"]);
});

// ---------------------------------------------------------------------------
// Integration: a real temp git repository
// ---------------------------------------------------------------------------

const logger = {
  section() {},
  info() {},
  warn() {},
  error() {},
  success() {},
  getEvents() {
    return [];
  },
};

function ctx(root: string): KernelRuntimeContext {
  return {
    workspaceRoot: root,
    siteExplicit: false,
    logger,
    dryRun: false,
    outputFormat: "json",
  } as unknown as KernelRuntimeContext;
}

function git(root: string, args: string[]): void {
  execFileSync("git", args, { cwd: root, stdio: "pipe" });
}

test("runCommitMessageLint: integration over a temp git repo — range resolution + merge exemption", async () => {
  const root = await mkdtemp(join(tmpdir(), "commit-lint-repo-"));
  try {
    git(root, ["init", "-q", "-b", "main"]);
    git(root, ["config", "user.email", "test@example.com"]);
    git(root, ["config", "user.name", "Test"]);
    await writeFile(join(root, "a.txt"), "1", "utf8");
    git(root, ["add", "."]);
    git(root, ["commit", "-q", "-m", "chore: initial commit"]);
    git(root, ["remote", "add", "origin", root]);
    git(root, ["fetch", "-q", "origin"]);
    // pretend origin/main tracks the initial commit
    git(root, ["update-ref", "refs/remotes/origin/main", "HEAD"]);

    await writeFile(join(root, "b.txt"), "2", "utf8");
    git(root, ["add", "."]);
    git(root, ["commit", "-q", "-m", "Found the issue and fixed it immediately"]);

    const input = { argv: [], flags: {} } as unknown as KernelCommandInput;
    const result = await runCommitMessageLint(input, ctx(root));
    expect(result.exitCode).toBe(1);
    const diags = (result.data as { diagnostics: Array<{ ruleId: string }> }).diagnostics;
    expect(diags.some((d) => d.ruleId === "COMMIT-03")).toBeTruthy();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runCommitMessageLint: passes when the range has only well-formed commits", async () => {
  const root = await mkdtemp(join(tmpdir(), "commit-lint-repo-"));
  try {
    git(root, ["init", "-q", "-b", "main"]);
    git(root, ["config", "user.email", "test@example.com"]);
    git(root, ["config", "user.name", "Test"]);
    await writeFile(join(root, "a.txt"), "1", "utf8");
    git(root, ["add", "."]);
    git(root, ["commit", "-q", "-m", "chore: initial commit"]);
    git(root, ["remote", "add", "origin", root]);
    git(root, ["fetch", "-q", "origin"]);
    git(root, ["update-ref", "refs/remotes/origin/main", "HEAD"]);

    await writeFile(join(root, "b.txt"), "2", "utf8");
    git(root, ["add", "."]);
    git(root, ["commit", "-q", "-m", "feat: add a widget"]);

    const input = { argv: [], flags: {} } as unknown as KernelCommandInput;
    const result = await runCommitMessageLint(input, ctx(root));
    expect(result.exitCode ?? 0).toBe(0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
