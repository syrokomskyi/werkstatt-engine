/*
<MODULE_CONTRACT>
<purpose>Facilitates management of entity and path registries for integrity tracking.</purpose>
<non-goals>
  <item>Do not handle raw content parsing or validation.</item>
  <item>Do not manage transport or configuration orchestration.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Tidied by compass.changesummary.tidy; see git history for prior entries.</item>
</CHANGE_SUMMARY>
*/
// @ts-nocheck


/**
 * Entity and path registry management for integrity tracking.
 * Manages the central entity-by-id and paths-current indexes.
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
import { pathExists } from "./fs.ts";
import { readJsonFile, writeJsonFile } from "./json.ts";
import { currentPathsPath, entitiesByIdPath } from "./paths.ts";
import type { EntitiesById, PathsCurrent } from "./types.ts";
export async function loadEntitiesById(cwd: string): Promise<EntitiesById> {
  if (stryMutAct_9fa48("698")) {
    {}
  } else {
    stryCov_9fa48("698");
    const filePath = entitiesByIdPath(cwd);
    if (stryMutAct_9fa48("701") ? false : stryMutAct_9fa48("700") ? true : stryMutAct_9fa48("699") ? await pathExists(filePath) : (stryCov_9fa48("699", "700", "701"), !(await pathExists(filePath)))) return {};
    return readJsonFile<EntitiesById>(filePath);
  }
}
export async function saveEntitiesById(cwd: string, value: EntitiesById): Promise<void> {
  if (stryMutAct_9fa48("702")) {
    {}
  } else {
    stryCov_9fa48("702");
    await writeJsonFile(entitiesByIdPath(cwd), value);
  }
}
export async function loadPathsCurrent(cwd: string): Promise<PathsCurrent> {
  if (stryMutAct_9fa48("703")) {
    {}
  } else {
    stryCov_9fa48("703");
    const filePath = currentPathsPath(cwd);
    if (stryMutAct_9fa48("706") ? false : stryMutAct_9fa48("705") ? true : stryMutAct_9fa48("704") ? await pathExists(filePath) : (stryCov_9fa48("704", "705", "706"), !(await pathExists(filePath)))) return {};
    return readJsonFile<PathsCurrent>(filePath);
  }
}
export async function savePathsCurrent(cwd: string, value: PathsCurrent): Promise<void> {
  if (stryMutAct_9fa48("707")) {
    {}
  } else {
    stryCov_9fa48("707");
    await writeJsonFile(currentPathsPath(cwd), value);
  }
}
export function bindPath(entities: EntitiesById, paths: PathsCurrent, entityId: string, repoPath: string): void {
  if (stryMutAct_9fa48("708")) {
    {}
  } else {
    stryCov_9fa48("708");
    const previousPath = stryMutAct_9fa48("709") ? entities[entityId].currentPath : (stryCov_9fa48("709"), entities[entityId]?.currentPath);
    if (stryMutAct_9fa48("712") ? previousPath || previousPath !== repoPath : stryMutAct_9fa48("711") ? false : stryMutAct_9fa48("710") ? true : (stryCov_9fa48("710", "711", "712"), previousPath && (stryMutAct_9fa48("714") ? previousPath === repoPath : stryMutAct_9fa48("713") ? true : (stryCov_9fa48("713", "714"), previousPath !== repoPath)))) {
      if (stryMutAct_9fa48("715")) {
        {}
      } else {
        stryCov_9fa48("715");
        delete paths[previousPath];
      }
    }
    paths[repoPath] = entityId;
    if (stryMutAct_9fa48("717") ? false : stryMutAct_9fa48("716") ? true : (stryCov_9fa48("716", "717"), entities[entityId])) {
      if (stryMutAct_9fa48("718")) {
        {}
      } else {
        stryCov_9fa48("718");
        entities[entityId].currentPath = repoPath;
      }
    }
  }
}
export function unbindPath(entities: EntitiesById, paths: PathsCurrent, repoPath: string): void {
  if (stryMutAct_9fa48("719")) {
    {}
  } else {
    stryCov_9fa48("719");
    const entityId = paths[repoPath];
    delete paths[repoPath];
    if (stryMutAct_9fa48("722") ? entityId || entities[entityId] : stryMutAct_9fa48("721") ? false : stryMutAct_9fa48("720") ? true : (stryCov_9fa48("720", "721", "722"), entityId && entities[entityId])) {
      if (stryMutAct_9fa48("723")) {
        {}
      } else {
        stryCov_9fa48("723");
        entities[entityId].status = stryMutAct_9fa48("724") ? "" : (stryCov_9fa48("724"), "deleted");
      }
    }
  }
}