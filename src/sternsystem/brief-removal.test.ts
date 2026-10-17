/*
<MODULE_CONTRACT>
<purpose>RFC-1307 AC-13: the 00-brief.md registration path is gone — no live
source under any package src directory imports parseBriefFrontmatter or BriefFrontmatter.</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1307: created.</item>
  <item>RFC-1307: step 5 — remove 00-brief.md path, onboarding.synthesize and brief.validate; cold run registers from intake</item>
</CHANGE_SUMMARY>
*/

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const packagesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SKIP = new Set(["node_modules", "dist", ".turbo", ".coverage", ".stryker-tmp"]);
const PATTERN = new RegExp(
  ["parse", "Brief", "Frontmatter|\\b", "Brief", "Frontmatter\\b"].join(""),
);
const SELF = fileURLToPath(import.meta.url);

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|astro|mjs)$/.test(name) && full !== SELF) out.push(full);
  }
}

describe("brief path removal (RFC-1307)", () => {
  it("AC-13: no live importer of the removed brief parser remains", () => {
    const files: string[] = [];
    for (const pkg of readdirSync(packagesDir)) {
      const src = join(packagesDir, pkg, "src");
      try {
        if (statSync(src).isDirectory()) walk(src, files);
      } catch {
        // package without src/
      }
    }
    const offenders = files
      .filter((f) => PATTERN.test(readFileSync(f, "utf8")))
      .map((f) => relative(packagesDir, f));
    expect(offenders, "remove these brief-parser references (RFC-1307, I3)").toEqual([]);
  });
});
