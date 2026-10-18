/**
 * <module_info>
 * <purpose>Shared run-twice harness for `rerun-safe` command tests (RFC-1327): runs a command closure twice against one fixture, snapshots caller-owned state between runs, and asserts the second run converges — same exit status, no unexpected tree/git diff. Remote effects are exercised through the `context.io.exec` seam the command already uses (stub it in `run`), never mocked around it.</purpose>
 * <responsibilities>expectRerunSafe runner; snapshotGitTree probe (HEAD + porcelain status); SnapshotDiff report shape</responsibilities>
 * <dependencies>vitest expect; node:child_process execSync for git probes</dependencies>
 * <side_effects>none — delegates all mutation to the caller's run() closure</side_effects>
 * <error_strategy>assertion failure reports the diff list; run() exit-code shape is caller-defined via RunResult</error_strategy>
 * <non_goals>kernel dispatch (tests import handlers directly); remote-state stubbing (callers stub context.io.exec); multi-run (>2) sequences</non_goals>
 * </module_info>
 * <module_contract>
 * - Exports: expectRerunSafe, snapshotGitTree, RerunCase, RunResult.
 * - Contract: second run MUST report the same outcome as a converged-state run (exit 0 / same status) and MUST NOT change the snapshotted state — convergence, not absence of work.
 * </module_contract>
 * <consumers>
 *   <consumer name="mission-reconcile.rerun.test.ts" />
 *   <consumer name="ship-rerun.test.ts" />
 *   <consumer name="agent-search-index.rerun.test.ts (werkstatt-site)" />
 * </consumers>
 * <key_decisions>
 *   <item>RFC-1327: caller supplies run+snapshot so the harness stays handler-agnostic — kernel commands in this repo are invoked as imported functions in tests, not via a dispatch table.</item>
 *   <item>Snapshots are opaque strings compared by equality — domain-specific compare (e.g. ignoring timestamps) is the caller's normalizer, keeping the harness free of per-command special cases.</item>
 * </key_decisions>
 * <related_rfc>RFC-1327</related_rfc>
 * <change_summary>
 * <item>RFC-1327: initial harness — expectRerunSafe + snapshotGitTree per the accepted plan.</item>
 * </change_summary>
 */
import { execSync } from "node:child_process";
import { expect } from "vitest";

/** What a single run reports back to the harness. */
export interface RunResult {
  /** Process-style exit code; omit when the run has no exit-code surface. */
  exitCode?: number;
  /** Semantic status (e.g. "pass", "skipped", "already-reconciled"). */
  status?: string;
}

export interface RerunCase<TSnapshot, TRun extends RunResult = RunResult> {
  /** Execute the command under test once (run 1 and run 2 share the fixture). */
  run: () => Promise<TRun>;
  /** Fingerprint the state the command owns — must be deterministic. */
  snapshot: () => Promise<TSnapshot> | TSnapshot;
  /** Optional second-run expectation override; defaults to equal status + equal snapshot. */
  expectSecondRun?: (first: TRun, second: TRun) => void;
}

/**
 * Run `probe.run()` twice and assert the second run converges:
 * identical `status`/`exitCode` and an unchanged snapshot.
 */
export async function expectRerunSafe<TSnapshot, TRun extends RunResult = RunResult>(
  probe: RerunCase<TSnapshot, TRun>,
): Promise<{
  first: TRun;
  second: TRun;
  snapshot: TSnapshot;
}> {
  const first = await probe.run();
  const before = await probe.snapshot();
  const second = await probe.run();
  const after = await probe.snapshot();

  if (probe.expectSecondRun) {
    probe.expectSecondRun(first, second);
  } else {
    expect(second.status).toBe(first.status);
    expect(second.exitCode).toBe(first.exitCode);
  }
  expect(after, "second run changed owned state — command is not rerun-safe").toEqual(before);

  return { first, second, snapshot: after };
}

/**
 * Git-state probe for rerun tests: `<HEAD sha>\n<git status --porcelain>` of `dir`.
 * Captures commit movement plus dirty/untracked drift in one string.
 */
export function snapshotGitTree(dir: string): string {
  const git = (args: string) =>
    execSync(`git ${args}`, {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  return `${git("rev-parse HEAD")}\n${git("status --porcelain")}`;
}
