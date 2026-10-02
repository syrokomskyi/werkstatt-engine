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
  <item>RFC-1149: migrate ambient filesystem and process IO to the WorkspaceIO port across engine and shared</item>
  <item>RFC-1179: add releases/ to CACHE_CLONE_ONLY_PATTERNS so merge-restore keeps release evidence gitignored (ADR-0085 closed-workpiece exemption for deploy.smoke.run writes)</item>
</CHANGE_SUMMARY>
*/

import { createDefaultIO, type WorkspaceIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";
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
  // RFC-1179: release evidence must stay gitignored inside the site so the
  // ADR-0085 closed-workpiece exemption resolves declared writes[] for
  // deploy.smoke.run / site.smoke.run.
  "releases/",
];

export async function restoreCacheCloneGitignore(
  systemDir: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<boolean> {
  const gitignorePath = path.join(systemDir, ".gitignore");

  if (!(await io.exists(gitignorePath))) {
    const newContent =
      CACHE_CLONE_GITIGNORE_SENTINEL + "\n" + CACHE_CLONE_ONLY_PATTERNS.join("\n") + "\n";
    await writeFileIfChanged(gitignorePath, newContent);
    return true;
  }

  const content = await io.readFile(gitignorePath);

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

export async function untrackForbiddenGeneratedFiles(
  systemDir: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<string[]> {
  const untracked: string[] = [];
  const args = CACHE_CLONE_ONLY_PATTERNS.map((p) => JSON.stringify(p)).join(" ");
  const bulk = await io.exec("sh", ["-c", `git rm --cached --quiet ${args}`], { cwd: systemDir });
  if (bulk.exitCode === 0) {
    untracked.push(...CACHE_CLONE_ONLY_PATTERNS);
  } else {
    for (const pattern of CACHE_CLONE_ONLY_PATTERNS) {
      const single = await io.exec(
        "sh",
        ["-c", `git rm --cached --quiet ${JSON.stringify(pattern)}`],
        { cwd: systemDir },
      );
      if (single.exitCode === 0) untracked.push(pattern);
    }
  }
  return untracked;
}
