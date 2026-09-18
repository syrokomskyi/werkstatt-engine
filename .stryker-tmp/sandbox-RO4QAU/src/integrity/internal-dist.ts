/***************************************************************
 * <MODULE_CONTRACT>
 * <purpose>Facilitates the discovery of distribution files within a specified directory structure.</purpose>
 *  *  * <non-goals>
 * <item>Do not perform file content parsing or validation.</item>
 * <item>Do not manage build artifact storage or configuration.</item>
 * <item>Do not handle non-file system related errors.</item>
 * </non-goals>
 * </MODULE_CONTRACT>
 *  * <CHANGE_SUMMARY>
  <item>Tidied by compass.changesummary.tidy; see git history for prior entries.</item>
</CHANGE_SUMMARY>
 ***************************************************************/
// @ts-nocheck


/**
 * Discover distribution files for build artifact recording.
 * Recursively walks the dist directory to collect all output files.
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
import path from "node:path";
import { collectFiles } from "@warpgogol/werkstatt-shared/share/fs";
export async function discoverDistFiles(cwd: string, distDir = stryMutAct_9fa48("514") ? "" : (stryCov_9fa48("514"), "dist")): Promise<string[]> {
  if (stryMutAct_9fa48("515")) {
    {}
  } else {
    stryCov_9fa48("515");
    const root = path.join(cwd, distDir);
    const files = await collectFiles(root, stryMutAct_9fa48("516") ? {} : (stryCov_9fa48("516"), {
      ignore: stryMutAct_9fa48("517") ? () => undefined : (stryCov_9fa48("517"), () => stryMutAct_9fa48("518") ? true : (stryCov_9fa48("518"), false))
    }));
    return stryMutAct_9fa48("519") ? files.map(abs => path.relative(cwd, abs).replace(/\\/g, "/")) : (stryCov_9fa48("519"), files.map(stryMutAct_9fa48("520") ? () => undefined : (stryCov_9fa48("520"), abs => path.relative(cwd, abs).replace(/\\/g, stryMutAct_9fa48("521") ? "" : (stryCov_9fa48("521"), "/")))).sort(stryMutAct_9fa48("522") ? () => undefined : (stryCov_9fa48("522"), (a, b) => a.localeCompare(b))));
  }
}