import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import path from "node:path";

const SRC_DIR = path.resolve(__dirname, "..");

function findTsFiles(dir: string, results: string[] = []): string[] {
  if (!existsSync(dir)) return results;
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory() && entry !== "node_modules" && entry !== "tests-handoff") {
      findTsFiles(fullPath, results);
    } else if (
      entry.endsWith(".ts") &&
      !entry.endsWith(".test.ts") &&
      !entry.endsWith(".spec.ts")
    ) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Check if a line is inside a block comment or is a line comment.
 */
function isInComment(fileContent: string, targetLineIdx: number): boolean {
  const lines = fileContent.split("\n");
  let inBlockComment = false;
  for (let i = 0; i <= targetLineIdx && i < lines.length; i++) {
    const line = lines[i];
    if (inBlockComment) {
      if (line.includes("*/")) {
        inBlockComment = false;
      }
      if (i === targetLineIdx) return true;
    } else {
      if (line.trim().startsWith("//")) {
        if (i === targetLineIdx) return true;
        continue;
      }
      if (line.includes("/*")) {
        inBlockComment = true;
        if (i === targetLineIdx) return true;
      }
    }
  }
  return false;
}

describe("cache-clone commit guard (RFC-0821)", () => {
  it("no raw git commit without MISSION_GIT_COMMIT env var in src/**", () => {
    const files = findTsFiles(SRC_DIR);
    const violations: Array<{ file: string; line: number; content: string }> = [];

    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (isInComment(content, i)) continue;

        // Only match actual function calls that execute git commit (not rev-parse, etc.):
        // execSync(`git commit ...`), gitExec(dir, `commit ...`), git(dir, `commit ...`)
        // Also match execSync("git commit ...") with double quotes
        const hasExecGitCommit =
          (line.includes("execSync(") || line.includes("gitExec(") || /\bgit\(/.test(line)) &&
          (line.includes("commit -m") ||
            line.includes("commit -m") ||
            line.includes("`commit ") ||
            line.includes('"commit '));

        if (!hasExecGitCommit) continue;

        // Skip allowed helpers that handle MISSION_GIT_COMMIT internally
        if (
          line.includes("cacheCloneCommit") ||
          line.includes("commitDirIfDirty") ||
          line.includes("commitAndPushBordbuch") ||
          line.includes("appendAndCommitBordbuch") ||
          line.includes("commitBordbuchProjections") ||
          line.includes("commitWerkstattSideEffects") ||
          line.includes("createSignedCommit") ||
          line.includes("commitWorkpieceIfDirty") ||
          line.includes("commitCacheCloneIfDirty")
        ) {
          continue;
        }

        // Skip the git() and gitExec helpers themselves
        if (file.endsWith("mission-git-commit.ts")) continue;
        if (file.endsWith("git-exec.ts")) continue;
        // signed-commit.ts uses the git() helper from mission-git-commit.ts which sets MISSION_GIT_COMMIT
        if (file.endsWith("signed-commit.ts")) continue;

        // Skip --no-verify commits (intentionally bypasses hook)
        if (line.includes("--no-verify")) continue;

        // Check surrounding context (current line + next 5 lines) for MISSION_GIT_COMMIT
        const context = lines.slice(i, Math.min(i + 6, lines.length)).join("\n");

        if (!context.includes("MISSION_GIT_COMMIT") && !context.includes("ECOSYSTEM_COMMIT")) {
          violations.push({
            file: path.relative(SRC_DIR, file),
            line: i + 1,
            content: line.trim(),
          });
        }
      }
    }

    if (violations.length > 0) {
      const formatted = violations.map((v) => `  ${v.file}:${v.line} — ${v.content}`).join("\n");
      expect.fail(
        `Found ${violations.length} raw git commit call(s) without MISSION_GIT_COMMIT env var.\n` +
          `Use cacheCloneCommit() from mission-git-commit.ts instead.\n` +
          `Violations:\n${formatted}`,
      );
    }
  });
});
