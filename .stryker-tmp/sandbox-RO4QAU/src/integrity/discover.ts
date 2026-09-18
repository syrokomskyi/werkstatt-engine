/*
<MODULE_CONTRACT>
<purpose>Supports the identification and organization of files and directories according to integrity policies.</purpose>
<non-goals>
  <item>Do not parse or manipulate the content of files.</item>
  <item>Do not manage Git repository configurations or states.</item>
  <item>Do not provide user interface or command-line functionalities.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Added Compass scaffolding to clarify module purpose and responsibilities.</item>
</CHANGE_SUMMARY>
*/
// @ts-nocheck


/**
 * Discover managed files based on integrity policy.
 * Filters Git-tracked files against include/exclude glob patterns.
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
import { getTrackedFiles } from "./git.ts";
import { loadPolicy, isManagedPath } from "./policy.ts";
export async function discoverManagedFiles(cwd: string): Promise<string[]> {
  if (stryMutAct_9fa48("37")) {
    {}
  } else {
    stryCov_9fa48("37");
    const policy = await loadPolicy(cwd);
    const tracked = await getTrackedFiles(cwd);
    return stryMutAct_9fa48("39") ? tracked.map(filePath => filePath.replace(/\\/g, "/")).sort((a, b) => a.localeCompare(b)) : stryMutAct_9fa48("38") ? tracked.map(filePath => filePath.replace(/\\/g, "/")).filter(filePath => isManagedPath(filePath, policy)) : (stryCov_9fa48("38", "39"), tracked.map(stryMutAct_9fa48("40") ? () => undefined : (stryCov_9fa48("40"), filePath => filePath.replace(/\\/g, stryMutAct_9fa48("41") ? "" : (stryCov_9fa48("41"), "/")))).filter(stryMutAct_9fa48("42") ? () => undefined : (stryCov_9fa48("42"), filePath => isManagedPath(filePath, policy))).sort(stryMutAct_9fa48("43") ? () => undefined : (stryCov_9fa48("43"), (a, b) => a.localeCompare(b))));
  }
}
export async function discoverManagedDirectories(cwd: string): Promise<string[]> {
  if (stryMutAct_9fa48("44")) {
    {}
  } else {
    stryCov_9fa48("44");
    const files = await discoverManagedFiles(cwd);
    return stryMutAct_9fa48("45") ? Array.from(new Set(files.map(filePath => path.posix.dirname(filePath)))) : (stryCov_9fa48("45"), Array.from(new Set(files.map(stryMutAct_9fa48("46") ? () => undefined : (stryCov_9fa48("46"), filePath => path.posix.dirname(filePath))))).sort(stryMutAct_9fa48("47") ? () => undefined : (stryCov_9fa48("47"), (a, b) => a.localeCompare(b))));
  }
}
export async function groupFilesByDirectory(filePaths: string[]): Promise<Map<string, string[]>> {
  if (stryMutAct_9fa48("48")) {
    {}
  } else {
    stryCov_9fa48("48");
    const map = new Map<string, string[]>();
    for (const filePath of filePaths) {
      if (stryMutAct_9fa48("49")) {
        {}
      } else {
        stryCov_9fa48("49");
        const dir = path.posix.dirname(filePath);
        const list = stryMutAct_9fa48("50") ? map.get(dir) && [] : (stryCov_9fa48("50"), map.get(dir) ?? (stryMutAct_9fa48("51") ? ["Stryker was here"] : (stryCov_9fa48("51"), [])));
        if (stryMutAct_9fa48("52")) {
          ;
        } else {
          stryCov_9fa48("52");
          list.push(filePath);
        }
        if (stryMutAct_9fa48("53")) {
          ;
        } else {
          stryCov_9fa48("53");
          map.set(dir, list);
        }
      }
    }
    for (const [dir, list] of map) {
      if (stryMutAct_9fa48("54")) {
        {}
      } else {
        stryCov_9fa48("54");
        map.set(dir, stryMutAct_9fa48("56") ? list : (stryCov_9fa48("56"), list.sort(stryMutAct_9fa48("57") ? () => undefined : (stryCov_9fa48("57"), (a, b) => a.localeCompare(b)))));
      }
    }
    return map;
  }
}