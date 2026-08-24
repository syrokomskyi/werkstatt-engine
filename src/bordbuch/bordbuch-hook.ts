/*
<MODULE_CONTRACT>
  <purpose>RFC-0658: installBordbuchPreCommitHook — writes a combined pre-commit guard to the cache clone that:
  1. Blocks direct git commit (RFC-0821 cache-clone commit guard) unless MISSION_GIT_COMMIT=1 is set.
  2. Rejects commits deleting bordbuch/events.ndjson (RFC-0658 bordbuch integrity guard).</purpose>
  <non-goals>
    <item>Does not validate bordbuch content — that is bordbuch.validate's responsibility.</item>
    <item>Does not install hooks in workpiece clones — git clone does not copy hooks.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0658: initial installBordbuchPreCommitHook implementation.</item>
  <item>RFC-0821: add cache-clone commit guard to block direct git commit in cache clones.</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { writeFileIfChanged } from "@warpgogol/werkstatt-engine/kernel";
import { CACHE_CLONE_COMMIT_GUARD_SCRIPT } from "../mission/cache-clone-commit-guard.ts";

export interface BordbuchHookResult {
  installed: boolean;
  hookPath: string;
  systemId: string;
}

const HOOK_SCRIPT = `#!/bin/sh
# Warpgogol cache-clone pre-commit hook (RFC-0658 + RFC-0821)
# Combined guards: commit guard + bordbuch integrity guard.

${CACHE_CLONE_COMMIT_GUARD_SCRIPT}
# Warpgogol bordbuch integrity guard (RFC-0658)
# Rejects commits that delete bordbuch/events.ndjson
if git diff --cached --name-status --diff-filter=D | grep -q 'bordbuch/events.ndjson$'; then
  echo "ERROR: refusing to delete bordbuch/events.ndjson (RFC-0658)" >&2
  echo "If you need to reset bordbuch, use bordbuch.repair instead." >&2
  exit 1
fi
`;

export async function installBordbuchPreCommitHook(
  cacheClonePath: string,
  systemId: string,
): Promise<BordbuchHookResult> {
  const hooksDir = path.join(cacheClonePath, ".git", "hooks");
  const hookPath = path.join(hooksDir, "pre-commit");

  if (!existsSync(path.join(cacheClonePath, ".git"))) {
    return { installed: false, hookPath, systemId };
  }

  if (!existsSync(hooksDir)) {
    await fs.mkdir(hooksDir, { recursive: true });
  }

  await writeFileIfChanged(hookPath, HOOK_SCRIPT);
  await fs.chmod(hookPath, 0o755);

  return { installed: true, hookPath, systemId };
}
