/******************************************************************************* 
<MODULE_CONTRACT> 
<purpose>Facilitates the verification of file integrity against predefined manifests, ensuring compliance with expected standards.</purpose> 
 
 
<non-goals> 
  <item>Do not handle raw file parsing or content validation directly.</item> 
  <item>Do not manage configuration or transport orchestration for verification processes.</item> 
</non-goals> 
</MODULE_CONTRACT> 
 
<CHANGE_SUMMARY>
  <item>Tidied by compass.changesummary.tidy; see git history for prior entries.</item>
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
