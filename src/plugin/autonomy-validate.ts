/*
<MODULE_CONTRACT>
<purpose>Autonomy guard for the Werkstatt engine (RFC-0772). Scans packages/werkstatt/src/**
for @warpgogol/* import specifiers that indicate stack-plugin coupling. Excludes
self-imports (@warpgogol/werkstatt-engine) and shared infrastructure packages (@warpgogol/werkstatt-shared/*)
which are not stack plugins.</purpose>

<non-goals>
  <item>Do not scan test files — tests may import from any package.</item>
  <item>Do not scan node_modules — only engine source is checked.</item>
  <item>Do not block on @warpgogol/werkstatt-shared/* — these are shared infrastructure packages.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0772: initial autonomy guard implementation modeled on forge.doctor precedent.</item>
  <item>RFC-0868: refactor to use shared import-scan-util.ts, removing duplicated scanning logic.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into <history>, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
</CHANGE_SUMMARY>
*/

import { join } from "node:path";
import { scanDirectoryForImports } from "./import-scan-util.ts";

/**
 * Packages that are exempt from the autonomy guard.
 * - @warpgogol/werkstatt-engine: self-imports (engine importing its own subpaths)
 * - @warpgogol/werkstatt-shared: shared infrastructure package (not a stack plugin)
 * - @warpgogol/forge: governance package (not a stack plugin)
 *
 * Stack-specific packages that SHOULD be flagged (not exempt):
 * - @warpgogol/werkstatt-site (stack plugin — engine MUST NOT import)
 *
 * RFC-0868 extracted shared infrastructure into @warpgogol/werkstatt-shared.
 * The engine now imports from @warpgogol/werkstatt-shared/* for shared schemas
 * and through plugin hooks for stack logic.
 */
const EXEMPT_PREFIXES = ["@warpgogol/werkstatt-engine", "@warpgogol/werkstatt-shared", "@warpgogol/forge"];

export interface AutonomyViolation {
  file: string;
  specifier: string;
}

export interface AutonomyValidateResult {
  command: string;
  status: "pass" | "fail";
  violations: AutonomyViolation[];
  scannedFiles: number;
}

/**
 * Check if a specifier is exempt (self-import or shared schema package).
 */
function isExempt(specifier: string): boolean {
  return EXEMPT_PREFIXES.some(
    (prefix) => specifier === prefix || specifier.startsWith(prefix + "/"),
  );
}

/**
 * Run the autonomy validation. Scans packages/werkstatt/src/** for forbidden
 * @warpgogol/* imports (excluding self-imports and shared schema packages).
 */
export async function runAutonomyValidate(workspaceRoot: string): Promise<AutonomyValidateResult> {
  const engineSrcDir = join(workspaceRoot, "packages", "werkstatt", "src");
  const { violations, scannedFiles } = await scanDirectoryForImports(
    engineSrcDir,
    workspaceRoot,
    (specifier) => specifier.startsWith("@warpgogol/") && !isExempt(specifier),
  );

  return {
    command: "werkstatt.autonomy.validate",
    status: violations.length === 0 ? "pass" : "fail",
    violations,
    scannedFiles,
  };
}
