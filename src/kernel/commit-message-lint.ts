/*
<MODULE_CONTRACT>
<purpose>
commit.message.lint — RFC-0265: enforces commit message hygiene for agent
commits. A commit subject is a short imperative statement of WHAT changed;
analysis, greetings, and status narration belong in the body or the PR, never
in the subject. Validates a git commit range (default: commits ahead of
origin/main) against four rules (COMMIT-01..04) and reports RFC-0203
Diagnostic[].
</purpose>
<non-goals>
  <item>Do not rewrite or reword existing commits — this is a read-only lint.</item>
  <item>Do not enforce a full conventional-commits toolchain — message shape only (see RFC's nonGoals).</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0265: initial implementation.</item>
</CHANGE_SUMMARY>
*/

import { execFileSync } from "node:child_process";
import type {
  CheckResult,
  Diagnostic,
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "./types.ts";

const RECORD_SEP = "\x1e";
const FIELD_SEP = "\x1f";

const CONVENTIONAL_PREFIX_RE =
  /^(feat|fix|docs|refactor|test|chore|build|ci|perf|style)(\([a-z0-9-]+\))?: [a-z]/;
const INTERJECTION_RE = /^(Good|Great|Found|Okay|Now|Let me|Perfect|Excellent)\b/;
const RFC_ID_RE = /\brfc-\d{4}\b/i;

export interface CommitRecord {
  hash: string;
  parents: string[];
  subject: string;
  body: string;
}

export interface CommitMessageFinding extends Diagnostic {
  ruleId: "COMMIT-01" | "COMMIT-02" | "COMMIT-03" | "COMMIT-04";
}

/** True when a commit is a merge (>1 parent) or a git-generated revert of one. */
export function isExempt(commit: Pick<CommitRecord, "subject" | "parents">): boolean {
  if (commit.parents.length > 1) return true;
  if (/^Revert\s+"/.test(commit.subject)) return true;
  return false;
}

/**
 * Pure per-commit rule evaluation — no git I/O. `changedFiles` is optional;
 * when omitted, COMMIT-04 (which needs the changed-file set) is skipped.
 */
export function lintCommitSubject(
  commit: CommitRecord,
  changedFiles?: string[],
): CommitMessageFinding[] {
  if (isExempt(commit)) return [];

  const findings: CommitMessageFinding[] = [];
  const { hash, subject, body } = commit;

  if (subject.length > 120) {
    findings.push({
      ruleId: "COMMIT-01",
      severity: "error",
      message: `${hash.slice(0, 8)}: subject is ${subject.length} characters, exceeding the 120-character limit.`,
      fixHint: "Shorten the subject to a single imperative clause; move detail into the body.",
      data: { hash, subject },
    });
  }

  if (!CONVENTIONAL_PREFIX_RE.test(subject)) {
    findings.push({
      ruleId: "COMMIT-02",
      severity: "error",
      message: `${hash.slice(0, 8)}: subject does not match "<type>(<scope>)?: <lowercase imperative clause>".`,
      fixHint:
        'Rewrite as e.g. "feat: add maintenance debt queues" (feat|fix|docs|refactor|test|chore|build|ci|perf|style).',
      data: { hash, subject },
    });
  }

  const isNarration =
    subject.startsWith("**") ||
    subject.startsWith("`") ||
    INTERJECTION_RE.test(subject) ||
    /\.\s+\S/.test(subject);
  if (isNarration) {
    findings.push({
      ruleId: "COMMIT-03",
      severity: "error",
      message: `${hash.slice(0, 8)}: subject looks like pasted analysis/narration rather than a commit subject.`,
      fixHint:
        "Write the subject as WHAT changed; put reasoning, findings, or status narration in the body instead.",
      data: { hash, subject },
    });
  }

  if (changedFiles && changedFiles.length > 0) {
    const touchesGoverned = changedFiles.some(
      (f) =>
        f.startsWith("packages/os/") ||
        (f.startsWith("docs/rfcs/") && !f.startsWith("docs/rfcs-audit/")),
    );
    if (touchesGoverned && !RFC_ID_RE.test(subject) && !RFC_ID_RE.test(body)) {
      findings.push({
        ruleId: "COMMIT-04",
        severity: "warning",
        message: `${hash.slice(0, 8)}: touches packages/os/** or docs/rfcs/** (excluding docs/rfcs-audit/**) but neither subject nor body references an RFC id.`,
        fixHint: "Reference the governing RFC id (e.g. rfc-0265) in the subject or body.",
        data: { hash, subject },
      });
    }
  }

  return findings;
}

/** Parse `git log --format=%H%x1f%P%x1f%s%x1f%b%x1e` output into commit records. */
export function parseGitLogOutput(raw: string): CommitRecord[] {
  return raw
    .split(RECORD_SEP)
    .map((record) => record.replace(/^\n/, "").trim())
    .filter((record) => record.length > 0)
    .map((record) => {
      const [hash = "", parentsRaw = "", subject = "", body = ""] = record.split(FIELD_SEP);
      return {
        hash,
        parents: parentsRaw.split(" ").filter(Boolean),
        subject,
        body: body.trim(),
      };
    });
}

/** Parse `git log --name-only --format=<marker>%H` output into hash -> changed files. */
export function parseNameOnlyOutput(raw: string, marker: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const blocks = raw
    .split(marker)
    .map((b) => b.trim())
    .filter(Boolean);
  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim());
    const hash = lines[0] ?? "";
    if (!hash) continue;
    const files = lines.slice(1).filter(Boolean);
    result.set(hash, files);
  }
  return result;
}

function resolveDefaultRange(workspaceRoot: string): string | null {
  try {
    execFileSync("git", ["rev-parse", "--verify", "origin/main"], {
      cwd: workspaceRoot,
      stdio: "pipe",
    });
    return "origin/main..HEAD";
  } catch {
    return null; // no origin/main (e.g. fresh repo, no remote) — nothing to lint.
  }
}

export async function runCommitMessageLint(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<CheckResult>> {
  const { workspaceRoot } = context;
  const range = (input.flags.range as string | undefined) ?? resolveDefaultRange(workspaceRoot);

  if (!range) {
    return {
      data: {
        command: "commit.message.lint",
        status: "pass",
        diagnostics: [],
        summary: { error: 0, warning: 0, info: 0 },
      },
      exitCode: 0,
      summary: "commit.message.lint: no range resolvable (no origin/main) — nothing to lint",
    };
  }

  let logRaw: string;
  try {
    logRaw = execFileSync(
      "git",
      ["log", range, `--format=${RECORD_SEP}%H${FIELD_SEP}%P${FIELD_SEP}%s${FIELD_SEP}%b`],
      { cwd: workspaceRoot, encoding: "utf8" },
    );
  } catch {
    return {
      data: {
        command: "commit.message.lint",
        status: "pass",
        diagnostics: [],
        summary: { error: 0, warning: 0, info: 0 },
      },
      exitCode: 0,
      summary: `commit.message.lint: range "${range}" resolved to no commits — nothing to lint`,
    };
  }

  const commits = parseGitLogOutput(logRaw);
  if (commits.length === 0) {
    return {
      data: {
        command: "commit.message.lint",
        status: "pass",
        diagnostics: [],
        summary: { error: 0, warning: 0, info: 0 },
      },
      exitCode: 0,
      summary: `commit.message.lint: range "${range}" has no commits — nothing to lint`,
    };
  }

  const NAME_ONLY_MARKER = "\x02COMMIT:";
  let nameOnlyRaw = "";
  try {
    nameOnlyRaw = execFileSync(
      "git",
      ["log", range, "--name-only", `--format=${NAME_ONLY_MARKER}%H`],
      { cwd: workspaceRoot, encoding: "utf8" },
    );
  } catch {
    nameOnlyRaw = "";
  }
  const changedFilesByHash = parseNameOnlyOutput(nameOnlyRaw, NAME_ONLY_MARKER);

  const diagnostics: Diagnostic[] = [];
  for (const commit of commits) {
    diagnostics.push(...lintCommitSubject(commit, changedFilesByHash.get(commit.hash)));
  }

  const summary = {
    error: diagnostics.filter((d) => d.severity === "error").length,
    warning: diagnostics.filter((d) => d.severity === "warning").length,
    info: 0,
  };
  const status: CheckResult["status"] =
    summary.error > 0 ? "fail" : summary.warning > 0 ? "warn" : "pass";

  return {
    data: { command: "commit.message.lint", status, diagnostics, summary },
    exitCode: summary.error > 0 ? 1 : 0,
    summary: `commit.message.lint: ${commits.length} commit(s) in range, ${summary.error} error${summary.error === 1 ? "" : "s"}, ${summary.warning} warning${summary.warning === 1 ? "" : "s"}`,
  };
}
