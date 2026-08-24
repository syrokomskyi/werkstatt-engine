/*
<MODULE_CONTRACT>
<purpose>RFC-0913: cache-clone .gitignore preservation — restore cache-clone-only .gitignore patterns after git merge and untrack forbidden/generated files that were re-tracked by the merge.</purpose>
<non-goals>
  <item>Does not perform the merge itself — called by mission.reconcile after git merge --no-ff succeeds.</item>
  <item>Does not validate bundle contract — sternsystem.validate remains the authority on forbidden file detection.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0913: initial module — CACHE_CLONE_GITIGNORE_SENTINEL, CACHE_CLONE_GENERATED_PATTERNS, CACHE_CLONE_ONLY_PATTERNS, restoreCacheCloneGitignore, untrackForbiddenGeneratedFiles.</item>
</CHANGE_SUMMARY>
*/

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { writeFileIfChanged } from "@warpgogol/werkstatt-engine/kernel";
import { FORBIDDEN_PATTERNS } from "../sternsystem/sternsystem-validate.ts";

export const CACHE_CLONE_GITIGNORE_SENTINEL = "# CACHE-CLONE-ONLY — do not remove";

export const CACHE_CLONE_GENERATED_PATTERNS: readonly string[] = [
  "behavior.snapshot.generated.yaml",
  "bordbuch/status.generated.yaml",
  "public/.well-known/bordbuch/status.generated.yaml",
  "src/agent-capabilities.generated.json",
  "src/agent-capabilities.generated.yaml",
  "src/agent-surface.generated.json",
  "src/agent-surface.generated.yaml",
  "src/entitlements.generated.yaml",
  "src/env.schema.generated.mjs",
  "src/freshness.generated.yaml",
  "src/styles/biome.generated.css",
  "src/surface.generated.yaml",
];

export const CACHE_CLONE_ONLY_PATTERNS: readonly string[] = [
  ...FORBIDDEN_PATTERNS.filter((p) => p !== "dist" && p !== "node_modules" && p !== "packages"),
  ...CACHE_CLONE_GENERATED_PATTERNS,
];

export async function restoreCacheCloneGitignore(systemDir: string): Promise<boolean> {
  const gitignorePath = path.join(systemDir, ".gitignore");

  if (!existsSync(gitignorePath)) {
    const newContent =
      CACHE_CLONE_GITIGNORE_SENTINEL + "\n" + CACHE_CLONE_ONLY_PATTERNS.join("\n") + "\n";
    await writeFileIfChanged(gitignorePath, newContent);
    return true;
  }

  const content = readFileSync(gitignorePath, "utf8");

  if (content.includes(CACHE_CLONE_GITIGNORE_SENTINEL)) {
    return false;
  }

  const newContent =
    content.trimEnd() +
    "\n\n" +
    CACHE_CLONE_GITIGNORE_SENTINEL +
    "\n" +
    CACHE_CLONE_ONLY_PATTERNS.join("\n") +
    "\n";
  await writeFileIfChanged(gitignorePath, newContent);
  return true;
}

export function untrackForbiddenGeneratedFiles(systemDir: string): string[] {
  const untracked: string[] = [];
  const args = CACHE_CLONE_ONLY_PATTERNS.map((p) => JSON.stringify(p)).join(" ");
  try {
    execSync(`git rm --cached --quiet ${args}`, {
      cwd: systemDir,
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf-8",
    });
    untracked.push(...CACHE_CLONE_ONLY_PATTERNS);
  } catch {
    for (const pattern of CACHE_CLONE_ONLY_PATTERNS) {
      try {
        execSync(`git rm --cached --quiet ${JSON.stringify(pattern)}`, {
          cwd: systemDir,
          stdio: ["pipe", "pipe", "pipe"],
          encoding: "utf-8",
        });
        untracked.push(pattern);
      } catch {
        // File not tracked — skip
      }
    }
  }
  return untracked;
}
