/******************************************************************************* 
<MODULE_CONTRACT> 
<purpose>run-verify — verifies file integrity against predefined manifests, ensuring tracked content matches.</purpose> 
 
 
<non-goals> 
  <item>Do not handle raw file parsing or content validation directly.</item> 
  <item>Do not manage configuration or transport orchestration for verification processes.</item> 
</non-goals> 
</MODULE_CONTRACT> 
 
<CHANGE_SUMMARY>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY> 
******************************************************************************/

/**
 * Verify integrity of all managed files against stored manifests.
 * Checks hashes, registry consistency, and JSON schema compliance.
 */

import { verifyIntegrity } from "./verify.ts";
import type { VerifyIssue, VerifyReport } from "./types.ts";

function formatIssue(issue: VerifyIssue): string {
  const prefix = issue.level === "error" ? "[ERROR]" : "[WARN ]";
  const location = [issue.path, issue.entityId].filter(Boolean).join(" | ");
  return `${prefix} ${issue.code}: ${issue.message}${location ? ` [${location}]` : ""}`;
}

function printSummary(report: VerifyReport): void {
  const { stats } = report;
  console.log("");
  console.log("Integrity summary");
  console.log(`  managed files       ${stats.managedFiles}`);
  console.log(`  managed directories ${stats.managedDirectories}`);
  console.log(`  manifests loaded    ${stats.manifestsLoaded}`);
  console.log(`  active entities     ${stats.activeEntities}`);
  console.log(`  path bindings       ${stats.activePathBindings}`);
  console.log(`  errors              ${stats.errors}`);
  console.log(`  warnings            ${stats.warnings}`);
}

export async function runVerify(args: { cwd: string }): Promise<VerifyReport> {
  const report = await verifyIntegrity(args.cwd);

  console.log("");
  console.log("Integrity verification report");

  for (const issue of report.issues) {
    console.error(formatIssue(issue));
  }

  printSummary(report);

  if (report.ok) {
    console.log("");
    console.log("Integrity verification passed.");
  } else {
    console.log("");
    console.error("Integrity verification failed.");
  }

  return report;
}
