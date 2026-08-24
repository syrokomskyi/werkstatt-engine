/*
<MODULE_CONTRACT>
<purpose>
RFC-0685: Workspace tree index — a single in-memory map of file paths to metadata
(mtimeMs, size) built once per pipeline run. Replaces N independent directory walks
with one walk + in-memory glob filtering.
</purpose>
<non-goals>
  <item>Do not implement cache storage — that lives in cache-layer.ts and sqlite-cache-layer.ts.</item>
  <item>Do not implement fingerprinting — that lives in @warpgogol/fingerprint.</item>
  <item>Do not implement cache read/write logic — that lives in command-result-cache.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0685: initial implementation — WorkspaceTreeEntry, WorkspaceTreeIndex, buildWorkspaceTreeIndex, filterTreeIndex.</item>
</CHANGE_SUMMARY>
*/

import { readdir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { Dirent } from "node:fs";
import picomatch from "picomatch";

export interface WorkspaceTreeEntry {
  mtimeMs: number;
  size: number;
}

export type WorkspaceTreeIndex = Map<string, WorkspaceTreeEntry>;

const DEFAULT_EXCLUDE_DIRS = [".git", "node_modules"];

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

/**
 * Build a workspace tree index: a Map from POSIX-relative file paths to
 * { mtimeMs, size } metadata. Walks the workspace root once, excluding
 * `.git/` and `node_modules/` by default.
 *
 * The `dist/` and `missions/` directories are intentionally NOT excluded
 * because some commands declare `reads` patterns matching files in those
 * directories (e.g. dist/client html files).
 */
export async function buildWorkspaceTreeIndex(
  workspaceRoot: string,
  excludeDirs?: string[],
): Promise<WorkspaceTreeIndex> {
  const exclude = new Set(excludeDirs ?? DEFAULT_EXCLUDE_DIRS);
  const index: WorkspaceTreeIndex = new Map();

  async function walk(dir: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (exclude.has(entry.name)) continue;
        await walk(join(dir, entry.name));
      } else if (entry.isFile()) {
        const abs = join(dir, entry.name);
        const rel = toPosix(relative(workspaceRoot, abs));
        try {
          const s = await stat(abs);
          index.set(rel, { mtimeMs: s.mtimeMs, size: s.size });
        } catch {
          // skip files that disappear between readdir and stat
        }
      }
    }
  }

  await walk(workspaceRoot);
  return index;
}

/**
 * Resolve the app token in a read pattern relative to the base directory,
 * then return the workspace-root-relative POSIX path.
 */
function resolvePattern(pattern: string, baseDir: string, workspaceRoot: string): string {
  return pattern.replace("<app>", toPosix(relative(workspaceRoot, baseDir)));
}

/**
 * Filter the workspace tree index against picomatch glob patterns.
 * Returns sorted absolute file paths matching any pattern.
 */
export function filterTreeIndex(
  index: WorkspaceTreeIndex,
  patterns: string[],
  baseDir: string,
  workspaceRoot: string,
): string[] {
  const resolvedPatterns = patterns.map((p) => resolvePattern(p, baseDir, workspaceRoot));
  const isMatch = picomatch(resolvedPatterns, { dot: true, nocase: false });
  const matched: string[] = [];
  for (const rel of index.keys()) {
    if (isMatch(rel)) {
      matched.push(join(workspaceRoot, ...rel.split("/")));
    }
  }
  return matched.sort();
}
