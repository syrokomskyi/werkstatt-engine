/*
<MODULE_CONTRACT>
<purpose>breaks-c-helper — extracted RFC frontmatter parsing helper for breaksC declaration (RFC-0520).</purpose>
<non-goals>
  <item>Does not validate RFC structure — only reads the breaksC field from frontmatter.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0520: initial extraction of breaksC frontmatter parsing from release.prepare inline block.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

export async function checkBreaksCDeclaration(
  workspaceRoot: string,
  rfcId: string,
): Promise<boolean> {
  const rfcPath = path.join(workspaceRoot, "docs", "rfcs", `rfc-${rfcId}.md`);
  if (!existsSync(rfcPath)) {
    return false;
  }
  const rfcRaw = await fs.readFile(rfcPath, "utf8");
  const fmMatch = rfcRaw.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) {
    return false;
  }
  const breaksMatch = fmMatch[1].match(/^breaksC:\s*(true|yes)/m);
  return !!breaksMatch;
}
