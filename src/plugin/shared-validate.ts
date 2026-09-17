/*
<MODULE_CONTRACT>
<purpose>Boundary guard for RFC-0868 + RFC-1104. Implements five checks:
SHARED-01: @warpgogol/werkstatt-shared is declared as a dependency in packages/werkstatt-engine/package.json
SHARED-02: No @warpgogol/werkstatt-site/* exemptions remain in EXEMPT_PREFIXES in autonomy-validate.ts
SHARED-03: No @warpgogol/werkstatt-site/* imports remain in packages/werkstatt-engine/src/** non-test files
SHARED-04: No @warpgogol/werkstatt-engine/* imports remain in packages/werkstatt-shared/src/** (RFC-1104 cycle break)
SHARED-05: packages/werkstatt-shared/package.json declares no dependency on @warpgogol/werkstatt-engine (RFC-1104 AC-1)</purpose>

<non-goals>
  <item>Does not scan werkstatt-shared for site imports — SHARED-04 only checks the engine boundary direction.</item>
  <item>Does not replace werkstatt.autonomy.validate — SHARED-03 is a cross-check, not a replacement.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0868: initial shared-validate implementing SHARED-01/02/03 per RFC spec.</item>
  <item>RFC-1104: added SHARED-04 — no werkstatt-engine imports inside werkstatt-shared/src.</item>
  <item>RFC-1104: added SHARED-05 — werkstatt-shared/package.json must not declare a dependency on werkstatt-engine.</item>
  <item>RFC-0868: use shared import-scan-util to avoid duplication with autonomy-validate.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { scanDirectoryForImports, type ImportViolation } from "./import-scan-util.ts";

const SHARED_PKG = "@warpgogol/werkstatt-shared";
const SITE_PREFIX = "@warpgogol/werkstatt-site";
const ENGINE_PREFIX = "@warpgogol/werkstatt-engine";

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
  const pkgJsonPath = join(workspaceRoot, "packages", "werkstatt-engine", "package.json");
  try {
    const content = await readFile(pkgJsonPath, "utf8");
    const pkg = JSON.parse(content);
    const deps = pkg.dependencies ?? {};
    const hasShared = SHARED_PKG in deps;
    return {
      id: "SHARED-01",
      status: hasShared ? "pass" : "fail",
      detail: hasShared
        ? `${SHARED_PKG} declared in packages/werkstatt-engine/package.json dependencies`
        : `${SHARED_PKG} missing from packages/werkstatt-engine/package.json dependencies`,
    };
  } catch {
    return {
      id: "SHARED-01",
      status: "fail",
      detail: `Cannot read packages/werkstatt-engine/package.json`,
    };
  }
}

async function checkExemptionHygiene(workspaceRoot: string): Promise<SharedCheckResult> {
  const autonomyPath = join(
    workspaceRoot,
    "packages",
    "werkstatt-engine",
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
      detail: `Cannot read packages/werkstatt-engine/src/plugin/autonomy-validate.ts`,
    };
  }
}

async function checkNoSiteImports(workspaceRoot: string): Promise<{
  result: SharedCheckResult;
  violations: ImportViolation[];
}> {
  const engineSrcDir = join(workspaceRoot, "packages", "werkstatt-engine", "src");
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
          ? `No ${SITE_PREFIX}/* imports in packages/werkstatt-engine/src/** (${scannedFiles} files scanned)`
          : `${violations.length} ${SITE_PREFIX}/* import(s) found in packages/werkstatt-engine/src/** (${scannedFiles} files scanned)`,
    },
    violations,
  };
}

async function checkNoEngineImportsInShared(workspaceRoot: string): Promise<{
  result: SharedCheckResult;
  violations: ImportViolation[];
}> {
  const sharedSrcDir = join(workspaceRoot, "packages", "werkstatt-shared", "src");
  const { violations, scannedFiles } = await scanDirectoryForImports(
    sharedSrcDir,
    workspaceRoot,
    (specifier) => specifier === ENGINE_PREFIX || specifier.startsWith(ENGINE_PREFIX + "/"),
  );

  return {
    result: {
      id: "SHARED-04",
      status: violations.length === 0 ? "pass" : "fail",
      detail:
        violations.length === 0
          ? `No ${ENGINE_PREFIX}/* imports in packages/werkstatt-shared/src/** (${scannedFiles} files scanned)`
          : `${violations.length} ${ENGINE_PREFIX}/* import(s) found in packages/werkstatt-shared/src/** (${scannedFiles} files scanned)`,
    },
    violations,
  };
}

async function checkSharedPackageDeclaresNoEngineDep(
  workspaceRoot: string,
): Promise<SharedCheckResult> {
  const pkgJsonPath = join(workspaceRoot, "packages", "werkstatt-shared", "package.json");
  try {
    const content = await readFile(pkgJsonPath, "utf8");
    const pkg = JSON.parse(content);
    const depFields = [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
    ] as const;
    const offenders = depFields.filter(
      (field) => pkg[field] && typeof pkg[field] === "object" && ENGINE_PREFIX in pkg[field],
    );
    const clean = offenders.length === 0;
    return {
      id: "SHARED-05",
      status: clean ? "pass" : "fail",
      detail: clean
        ? `packages/werkstatt-shared/package.json declares no ${ENGINE_PREFIX} dependency`
        : `${ENGINE_PREFIX} declared in packages/werkstatt-shared/package.json ${offenders.join(", ")} — must be removed`,
    };
  } catch {
    return {
      id: "SHARED-05",
      status: "fail",
      detail: `Cannot read packages/werkstatt-shared/package.json`,
    };
  }
}

export async function runSharedValidate(workspaceRoot: string): Promise<SharedValidateResult> {
  const [shared01, shared02, shared03Result, shared04Result, shared05] = await Promise.all([
    checkSharedDependency(workspaceRoot),
    checkExemptionHygiene(workspaceRoot),
    checkNoSiteImports(workspaceRoot),
    checkNoEngineImportsInShared(workspaceRoot),
    checkSharedPackageDeclaresNoEngineDep(workspaceRoot),
  ]);

  const checks = [shared01, shared02, shared03Result.result, shared04Result.result, shared05];
  const anyFail = checks.some((c) => c.status === "fail");

  return {
    command: "werkstatt.shared.validate",
    status: anyFail ? "fail" : "pass",
    checks,
  };
}
