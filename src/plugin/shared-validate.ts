/*
<MODULE_CONTRACT>
<purpose>Boundary guard for RFC-0868. Implements three checks:
SHARED-01: @warpgogol/werkstatt-shared is declared as a dependency in packages/werkstatt/package.json
SHARED-02: No @warpgogol/werkstatt-site/* exemptions remain in EXEMPT_PREFIXES in autonomy-validate.ts
SHARED-03: No @warpgogol/werkstatt-site/* imports remain in packages/werkstatt/src/** non-test files</purpose>
<keywords>shared, validate, RFC-0868, boundary guard, SHARED-01, SHARED-02, SHARED-03</keywords>
<non-goals>
  <item>Does not scan werkstatt-shared source — that is the shared package's own boundary, not the engine's.</item>
  <item>Does not replace werkstatt.autonomy.validate — SHARED-03 is a cross-check, not a replacement.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0868: initial shared-validate implementing SHARED-01/02/03 per RFC spec.</item>
  <item>RFC-0868: use shared import-scan-util to avoid duplication with autonomy-validate.</item>
</CHANGE_SUMMARY>
*/

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { scanDirectoryForImports, type ImportViolation } from "./import-scan-util.ts";

const SHARED_PKG = "@warpgogol/werkstatt-shared";
const SITE_PREFIX = "@warpgogol/werkstatt-site";

export interface SharedCheckResult {
  id: string;
  status: "pass" | "fail";
  detail: string;
}

export interface SharedValidateResult {
  command: string;
  status: "pass" | "fail";
  checks: SharedCheckResult[];
}

async function checkSharedDependency(workspaceRoot: string): Promise<SharedCheckResult> {
  const pkgJsonPath = join(workspaceRoot, "packages", "werkstatt", "package.json");
  try {
    const content = await readFile(pkgJsonPath, "utf8");
    const pkg = JSON.parse(content);
    const deps = pkg.dependencies ?? {};
    const hasShared = SHARED_PKG in deps;
    return {
      id: "SHARED-01",
      status: hasShared ? "pass" : "fail",
      detail: hasShared
        ? `${SHARED_PKG} declared in packages/werkstatt/package.json dependencies`
        : `${SHARED_PKG} missing from packages/werkstatt/package.json dependencies`,
    };
  } catch {
    return {
      id: "SHARED-01",
      status: "fail",
      detail: `Cannot read packages/werkstatt/package.json`,
    };
  }
}

async function checkExemptionHygiene(workspaceRoot: string): Promise<SharedCheckResult> {
  const autonomyPath = join(
    workspaceRoot,
    "packages",
    "werkstatt",
    "src",
    "plugin",
    "autonomy-validate.ts",
  );
  try {
    const content = await readFile(autonomyPath, "utf8");
    const hasSiteExemption = content.includes(`"@warpgogol/werkstatt-site"`);
    return {
      id: "SHARED-02",
      status: hasSiteExemption ? "fail" : "pass",
      detail: hasSiteExemption
        ? `${SITE_PREFIX} found in EXEMPT_PREFIXES in autonomy-validate.ts — must be removed`
        : `No ${SITE_PREFIX} exemptions in EXEMPT_PREFIXES in autonomy-validate.ts`,
    };
  } catch {
    return {
      id: "SHARED-02",
      status: "fail",
      detail: `Cannot read packages/werkstatt/src/plugin/autonomy-validate.ts`,
    };
  }
}

async function checkNoSiteImports(workspaceRoot: string): Promise<{
  result: SharedCheckResult;
  violations: ImportViolation[];
}> {
  const engineSrcDir = join(workspaceRoot, "packages", "werkstatt", "src");
  const { violations, scannedFiles } = await scanDirectoryForImports(
    engineSrcDir,
    workspaceRoot,
    (specifier) => specifier === SITE_PREFIX || specifier.startsWith(SITE_PREFIX + "/"),
  );

  return {
    result: {
      id: "SHARED-03",
      status: violations.length === 0 ? "pass" : "fail",
      detail:
        violations.length === 0
          ? `No ${SITE_PREFIX}/* imports in packages/werkstatt/src/** (${scannedFiles} files scanned)`
          : `${violations.length} ${SITE_PREFIX}/* import(s) found in packages/werkstatt/src/** (${scannedFiles} files scanned)`,
    },
    violations,
  };
}

export async function runSharedValidate(workspaceRoot: string): Promise<SharedValidateResult> {
  const [shared01, shared02, shared03Result] = await Promise.all([
    checkSharedDependency(workspaceRoot),
    checkExemptionHygiene(workspaceRoot),
    checkNoSiteImports(workspaceRoot),
  ]);

  const checks = [shared01, shared02, shared03Result.result];
  const anyFail = checks.some((c) => c.status === "fail");

  return {
    command: "werkstatt.shared.validate",
    status: anyFail ? "fail" : "pass",
    checks,
  };
}
