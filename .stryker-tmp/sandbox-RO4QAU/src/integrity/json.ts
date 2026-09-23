/******************************************************************************* 
<MODULE_CONTRACT> 
<purpose>Utility functions for reading, writing, and stringifying JSON data with a focus on integrity and determinism.</purpose> 
 
 
<non-goals> 
<item>Do not handle raw content parsing beyond JSON.</item> 
<item>Do not manage file transport or configuration orchestration.</item> 
</non-goals> 
</MODULE_CONTRACT> 
 
<CHANGE_SUMMARY>
  <item>Tidied by compass.changesummary.tidy; see git history for prior entries.</item>
</CHANGE_SUMMARY> 
******************************************************************************/
// @ts-nocheck


/**
 * JSON utilities with stable stringification for integrity files.
 * Provides sorted key output for deterministic file hashes.
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
import { ensureDir, readText, writeText } from "./fs.ts";
function sortValue(value: unknown): unknown {
  if (stryMutAct_9fa48("523")) {
    {}
  } else {
    stryCov_9fa48("523");
    if (stryMutAct_9fa48("525") ? false : stryMutAct_9fa48("524") ? true : (stryCov_9fa48("524", "525"), Array.isArray(value))) {
      if (stryMutAct_9fa48("526")) {
        {}
      } else {
        stryCov_9fa48("526");
        return value.map(sortValue);
      }
    }
    if (stryMutAct_9fa48("529") ? value || typeof value === "object" : stryMutAct_9fa48("528") ? false : stryMutAct_9fa48("527") ? true : (stryCov_9fa48("527", "528", "529"), value && (stryMutAct_9fa48("531") ? typeof value !== "object" : stryMutAct_9fa48("530") ? true : (stryCov_9fa48("530", "531"), typeof value === (stryMutAct_9fa48("532") ? "" : (stryCov_9fa48("532"), "object")))))) {
      if (stryMutAct_9fa48("533")) {
        {}
      } else {
        stryCov_9fa48("533");
        const entries = stryMutAct_9fa48("534") ? Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, sortValue(nested)]) : (stryCov_9fa48("534"), Object.entries(value as Record<string, unknown>).sort(stryMutAct_9fa48("535") ? () => undefined : (stryCov_9fa48("535"), ([a], [b]) => a.localeCompare(b))).map(stryMutAct_9fa48("536") ? () => undefined : (stryCov_9fa48("536"), ([key, nested]) => stryMutAct_9fa48("537") ? [] : (stryCov_9fa48("537"), [key, sortValue(nested)]))));
        return Object.fromEntries(entries);
      }
    }
    return value;
  }
}
export function stableStringify(value: unknown): string {
  if (stryMutAct_9fa48("538")) {
    {}
  } else {
    stryCov_9fa48("538");
    return stryMutAct_9fa48("539") ? `` : (stryCov_9fa48("539"), `${JSON.stringify(sortValue(value), null, 2)}\n`);
  }
}
export async function readJsonFile<T>(filePath: string): Promise<T> {
  if (stryMutAct_9fa48("540")) {
    {}
  } else {
    stryCov_9fa48("540");
    return JSON.parse(await readText(filePath)) as T;
  }
}
export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  if (stryMutAct_9fa48("541")) {
    {}
  } else {
    stryCov_9fa48("541");
    await ensureDir(path.dirname(filePath));
    await writeText(filePath, stableStringify(value));
  }
}