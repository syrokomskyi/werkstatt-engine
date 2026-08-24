/*
<MODULE_CONTRACT>
<purpose>RFC-0520: extracted RFC frontmatter parsing helper for breaksC declaration.</purpose>
<non-goals>
  <item>Does not validate RFC structure — only reads the breaksC field from frontmatter.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0520: initial extraction of breaksC frontmatter parsing from release.prepare inline block.</item>
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
