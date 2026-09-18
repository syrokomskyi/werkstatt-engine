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
// @ts-nocheck


/**
 * Verify integrity of all managed files against stored manifests.
 * Checks hashes, registry consistency, and JSON schema compliance.
 */function stryNS_9fa48() {
  var g = typeof globalThis === 'object' && globalThis && globalThis.Math === Math && globalThis || new Function("return this")();
  var ns = g.__stryker__ || (g.__stryker__ = {});
  if (ns.activeMutant === undefined && g.process && g.process.env && g.process.env.__STRYKER_ACTIVE_MUTANT__) {
    ns.activeMutant = g.process.env.__STRYKER_ACTIVE_MUTANT__;
  }
  function retrieveNS() {
    return ns;
  }
  stryNS_9fa48 = retrieveNS;
  return retrieveNS();
}
stryNS_9fa48();
function stryCov_9fa48() {
  var ns = stryNS_9fa48();
  var cov = ns.mutantCoverage || (ns.mutantCoverage = {
    static: {},
    perTest: {}
  });
  function cover() {
    var c = cov.static;
    if (ns.currentTestId) {
      c = cov.perTest[ns.currentTestId] = cov.perTest[ns.currentTestId] || {};
    }
    var a = arguments;
    for (var i = 0; i < a.length; i++) {
      c[a[i]] = (c[a[i]] || 0) + 1;
    }
  }
  stryCov_9fa48 = cover;
  cover.apply(null, arguments);
}
function stryMutAct_9fa48(id) {
  var ns = stryNS_9fa48();
  function isActive(id) {
    if (ns.activeMutant === id) {
      if (ns.hitCount !== void 0 && ++ns.hitCount > ns.hitLimit) {
        throw new Error('Stryker: Hit count limit reached (' + ns.hitCount + ')');
      }
      return true;
    }
    return false;
  }
  stryMutAct_9fa48 = isActive;
  return isActive(id);
}
import { verifyIntegrity } from "./verify.ts";
import type { VerifyIssue, VerifyReport } from "./types.ts";
function formatIssue(issue: VerifyIssue): string {
  if (stryMutAct_9fa48("1017")) {
    {}
  } else {
    stryCov_9fa48("1017");
    const prefix = (stryMutAct_9fa48("1020") ? issue.level !== "error" : stryMutAct_9fa48("1019") ? false : stryMutAct_9fa48("1018") ? true : (stryCov_9fa48("1018", "1019", "1020"), issue.level === (stryMutAct_9fa48("1021") ? "" : (stryCov_9fa48("1021"), "error")))) ? stryMutAct_9fa48("1022") ? "" : (stryCov_9fa48("1022"), "[ERROR]") : stryMutAct_9fa48("1023") ? "" : (stryCov_9fa48("1023"), "[WARN ]");
    const location = stryMutAct_9fa48("1024") ? [issue.path, issue.entityId].join(" | ") : (stryCov_9fa48("1024"), (stryMutAct_9fa48("1025") ? [] : (stryCov_9fa48("1025"), [issue.path, issue.entityId])).filter(Boolean).join(stryMutAct_9fa48("1026") ? "" : (stryCov_9fa48("1026"), " | ")));
    return stryMutAct_9fa48("1027") ? `` : (stryCov_9fa48("1027"), `${prefix} ${issue.code}: ${issue.message}${location ? stryMutAct_9fa48("1028") ? `` : (stryCov_9fa48("1028"), ` [${location}]`) : stryMutAct_9fa48("1029") ? "Stryker was here!" : (stryCov_9fa48("1029"), "")}`);
  }
}
function printSummary(report: VerifyReport): void {
  if (stryMutAct_9fa48("1030")) {
    {}
  } else {
    stryCov_9fa48("1030");
    const {
      stats
    } = report;
    console.log(stryMutAct_9fa48("1032") ? "Stryker was here!" : (stryCov_9fa48("1032"), ""));
    console.log(stryMutAct_9fa48("1034") ? "" : (stryCov_9fa48("1034"), "Integrity summary"));
    console.log(stryMutAct_9fa48("1036") ? `` : (stryCov_9fa48("1036"), `  managed files       ${stats.managedFiles}`));
    console.log(stryMutAct_9fa48("1038") ? `` : (stryCov_9fa48("1038"), `  managed directories ${stats.managedDirectories}`));
    console.log(stryMutAct_9fa48("1040") ? `` : (stryCov_9fa48("1040"), `  manifests loaded    ${stats.manifestsLoaded}`));
    console.log(stryMutAct_9fa48("1042") ? `` : (stryCov_9fa48("1042"), `  active entities     ${stats.activeEntities}`));
    console.log(stryMutAct_9fa48("1044") ? `` : (stryCov_9fa48("1044"), `  path bindings       ${stats.activePathBindings}`));
    console.log(stryMutAct_9fa48("1046") ? `` : (stryCov_9fa48("1046"), `  errors              ${stats.errors}`));
    console.log(stryMutAct_9fa48("1048") ? `` : (stryCov_9fa48("1048"), `  warnings            ${stats.warnings}`));
  }
}
export async function runVerify(args: {
  cwd: string;
}): Promise<VerifyReport> {
  if (stryMutAct_9fa48("1049")) {
    {}
  } else {
    stryCov_9fa48("1049");
    const report = await verifyIntegrity(args.cwd);
    console.log(stryMutAct_9fa48("1051") ? "Stryker was here!" : (stryCov_9fa48("1051"), ""));
    console.log(stryMutAct_9fa48("1053") ? "" : (stryCov_9fa48("1053"), "Integrity verification report"));
    for (const issue of report.issues) {
      if (stryMutAct_9fa48("1054")) {
        {}
      } else {
        stryCov_9fa48("1054");
        if (stryMutAct_9fa48("1055")) {
          ;
        } else {
          stryCov_9fa48("1055");
          console.error(formatIssue(issue));
        }
      }
    }
    if (stryMutAct_9fa48("1056")) {
      ;
    } else {
      stryCov_9fa48("1056");
      printSummary(report);
    }
    if (stryMutAct_9fa48("1058") ? false : stryMutAct_9fa48("1057") ? true : (stryCov_9fa48("1057", "1058"), report.ok)) {
      if (stryMutAct_9fa48("1059")) {
        {}
      } else {
        stryCov_9fa48("1059");
        console.log(stryMutAct_9fa48("1061") ? "Stryker was here!" : (stryCov_9fa48("1061"), ""));
        console.log(stryMutAct_9fa48("1063") ? "" : (stryCov_9fa48("1063"), "Integrity verification passed."));
      }
    } else {
      if (stryMutAct_9fa48("1064")) {
        {}
      } else {
        stryCov_9fa48("1064");
        console.log(stryMutAct_9fa48("1066") ? "Stryker was here!" : (stryCov_9fa48("1066"), ""));
        console.error(stryMutAct_9fa48("1068") ? "" : (stryCov_9fa48("1068"), "Integrity verification failed."));
      }
    }
    return report;
  }
}