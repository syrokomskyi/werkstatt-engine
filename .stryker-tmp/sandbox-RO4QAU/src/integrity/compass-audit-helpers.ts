/*
<MODULE_CONTRACT>
<purpose>Provides a revision-by-path lookup helper that wraps the integrity registry with a git-history fallback, for consumers like the Compass audit system (RFC-0352).</purpose>
<non-goals>
  <item>Do not compute a new per-file counter — reuse the existing integrity revision.</item>
  <item>Do not modify the registry or write any files.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0352: initial implementation of getRevisionByPath helper.</item>
</CHANGE_SUMMARY>
*/
// @ts-nocheck
function stryNS_9fa48() {
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
import { loadEntitiesById, loadPathsCurrent } from "./registry.ts";
import { getFileRevisionFromHistory } from "./git.ts";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
export interface RevisionByPathResult {
  revision: number;
  entityId: string | null;
  contentHash: string;
}
export async function getRevisionByPath(cwd: string, repoPath: string): Promise<RevisionByPathResult> {
  if (stryMutAct_9fa48("17")) {
    {}
  } else {
    stryCov_9fa48("17");
    const paths = await loadPathsCurrent(cwd);
    const entityId = paths[repoPath];
    if (stryMutAct_9fa48("19") ? false : stryMutAct_9fa48("18") ? true : (stryCov_9fa48("18", "19"), entityId)) {
      if (stryMutAct_9fa48("20")) {
        {}
      } else {
        stryCov_9fa48("20");
        const entities = await loadEntitiesById(cwd);
        const entity = entities[entityId];
        if (stryMutAct_9fa48("22") ? false : stryMutAct_9fa48("21") ? true : (stryCov_9fa48("21", "22"), entity)) {
          if (stryMutAct_9fa48("23")) {
            {}
          } else {
            stryCov_9fa48("23");
            let contentHash = entity.contentHash;
            // Compute live hash if the file exists
            try {
              if (stryMutAct_9fa48("24")) {
                {}
              } else {
                stryCov_9fa48("24");
                const abs = resolve(cwd, repoPath);
                const content = await readFile(abs, stryMutAct_9fa48("25") ? "" : (stryCov_9fa48("25"), "utf8"));
                contentHash = (stryMutAct_9fa48("26") ? "" : (stryCov_9fa48("26"), "sha256-")) + createHash(stryMutAct_9fa48("27") ? "" : (stryCov_9fa48("27"), "sha256")).update(content).digest(stryMutAct_9fa48("28") ? "" : (stryCov_9fa48("28"), "hex"));
              }
            } catch {
              // keep registry hash
            }
            return stryMutAct_9fa48("29") ? {} : (stryCov_9fa48("29"), {
              revision: entity.revision,
              entityId,
              contentHash
            });
          }
        }
      }
    }

    // Fallback: compute revision from git history
    const revision = await getFileRevisionFromHistory(cwd, repoPath);
    let contentHash = stryMutAct_9fa48("30") ? "Stryker was here!" : (stryCov_9fa48("30"), "");
    try {
      if (stryMutAct_9fa48("31")) {
        {}
      } else {
        stryCov_9fa48("31");
        const abs = resolve(cwd, repoPath);
        const content = await readFile(abs, stryMutAct_9fa48("32") ? "" : (stryCov_9fa48("32"), "utf8"));
        contentHash = (stryMutAct_9fa48("33") ? "" : (stryCov_9fa48("33"), "sha256-")) + createHash(stryMutAct_9fa48("34") ? "" : (stryCov_9fa48("34"), "sha256")).update(content).digest(stryMutAct_9fa48("35") ? "" : (stryCov_9fa48("35"), "hex"));
      }
    } catch {
      // file may not exist
    }
    return stryMutAct_9fa48("36") ? {} : (stryCov_9fa48("36"), {
      revision,
      entityId: null,
      contentHash
    });
  }
}