/******************************************************************************* 
<MODULE_CONTRACT> 
<purpose>Maintains packages/os/site-kernel-integrity/src/fs.ts as an authored site-kernel-integrity authored module so agents can evolve it without rediscovering local boundaries.</purpose>
 
 
<non-goals> 
  <item>Do not handle file system event monitoring.</item> 
  <item>Do not parse raw content here.</item> 
  <item>Do not manage file permissions or ownership.</item> 
</non-goals> 
</MODULE_CONTRACT> 
 
<CHANGE_SUMMARY>
  <item>Tidied by compass.changesummary.tidy; see git history for prior entries.</item>
</CHANGE_SUMMARY> 
*******************************************************************************/
// @ts-nocheck


/**
 * File system utilities for integrity operations.
 * Provides async wrappers for directory creation, file read/write, and path checks.
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
import { promises as fs } from "node:fs";
export async function ensureDir(dirPath: string): Promise<void> {
  if (stryMutAct_9fa48("58")) {
    {}
  } else {
    stryCov_9fa48("58");
    await fs.mkdir(dirPath, stryMutAct_9fa48("59") ? {} : (stryCov_9fa48("59"), {
      recursive: stryMutAct_9fa48("60") ? false : (stryCov_9fa48("60"), true)
    }));
  }
}
export async function pathExists(targetPath: string): Promise<boolean> {
  if (stryMutAct_9fa48("61")) {
    {}
  } else {
    stryCov_9fa48("61");
    try {
      if (stryMutAct_9fa48("62")) {
        {}
      } else {
        stryCov_9fa48("62");
        await fs.access(targetPath);
        return stryMutAct_9fa48("63") ? false : (stryCov_9fa48("63"), true);
      }
    } catch {
      if (stryMutAct_9fa48("64")) {
        {}
      } else {
        stryCov_9fa48("64");
        return stryMutAct_9fa48("65") ? true : (stryCov_9fa48("65"), false);
      }
    }
  }
}
export async function readText(filePath: string): Promise<string> {
  if (stryMutAct_9fa48("66")) {
    {}
  } else {
    stryCov_9fa48("66");
    return fs.readFile(filePath, stryMutAct_9fa48("67") ? "" : (stryCov_9fa48("67"), "utf8"));
  }
}
export async function writeText(filePath: string, content: string): Promise<void> {
  if (stryMutAct_9fa48("68")) {
    {}
  } else {
    stryCov_9fa48("68");
    await fs.writeFile(filePath, content, stryMutAct_9fa48("69") ? "" : (stryCov_9fa48("69"), "utf8"));
  }
}
export async function readBuffer(filePath: string): Promise<Buffer> {
  if (stryMutAct_9fa48("70")) {
    {}
  } else {
    stryCov_9fa48("70");
    return fs.readFile(filePath);
  }
}