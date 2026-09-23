/*******************************************************************************  
<MODULE_CONTRACT>  
<purpose>Defines path utilities for managing integrity-related file locations within a specified working directory.</purpose>  
  
  
<non-goals>  
  <item>Do not handle file reading or writing operations.</item>  
  <item>Do not manage integrity validation or enforcement logic.</item>  
  <item>Do not parse raw content from files.</item>  
</non-goals>  
</MODULE_CONTRACT>  
  
<CHANGE_SUMMARY>
  <item>Tidied by compass.changesummary.tidy; see git history for prior entries.</item>
</CHANGE_SUMMARY>  
******************************************************************************/
// @ts-nocheck


/**
 * Path constants and utilities for integrity file locations.
 * Defines all paths within the .integrity directory structure.
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
export function integrityRoot(cwd: string): string {
  if (stryMutAct_9fa48("593")) {
    {}
  } else {
    stryCov_9fa48("593");
    return path.join(cwd, stryMutAct_9fa48("594") ? "" : (stryCov_9fa48("594"), ".integrity"));
  }
}
export function configDir(cwd: string): string {
  if (stryMutAct_9fa48("595")) {
    {}
  } else {
    stryCov_9fa48("595");
    return path.join(integrityRoot(cwd), stryMutAct_9fa48("596") ? "" : (stryCov_9fa48("596"), "config"));
  }
}
export function schemaDir(cwd: string): string {
  if (stryMutAct_9fa48("597")) {
    {}
  } else {
    stryCov_9fa48("597");
    return path.join(integrityRoot(cwd), stryMutAct_9fa48("598") ? "" : (stryCov_9fa48("598"), "schema"));
  }
}
export function policyPath(cwd: string): string {
  if (stryMutAct_9fa48("599")) {
    {}
  } else {
    stryCov_9fa48("599");
    return path.join(configDir(cwd), stryMutAct_9fa48("600") ? "" : (stryCov_9fa48("600"), "policy.json"));
  }
}
export function indexDir(cwd: string): string {
  if (stryMutAct_9fa48("601")) {
    {}
  } else {
    stryCov_9fa48("601");
    return path.join(integrityRoot(cwd), stryMutAct_9fa48("602") ? "" : (stryCov_9fa48("602"), "index"));
  }
}
export function entitiesByIdPath(cwd: string): string {
  if (stryMutAct_9fa48("603")) {
    {}
  } else {
    stryCov_9fa48("603");
    return path.join(indexDir(cwd), stryMutAct_9fa48("604") ? "" : (stryCov_9fa48("604"), "entities.by-id.json"));
  }
}
export function currentPathsPath(cwd: string): string {
  if (stryMutAct_9fa48("605")) {
    {}
  } else {
    stryCov_9fa48("605");
    return path.join(indexDir(cwd), stryMutAct_9fa48("606") ? "" : (stryCov_9fa48("606"), "paths.current.json"));
  }
}
export function manifestsRoot(cwd: string): string {
  if (stryMutAct_9fa48("607")) {
    {}
  } else {
    stryCov_9fa48("607");
    return path.join(integrityRoot(cwd), stryMutAct_9fa48("608") ? "" : (stryCov_9fa48("608"), "manifests"));
  }
}
export function manifestPathForDirectory(cwd: string, repoDir: string): string {
  if (stryMutAct_9fa48("609")) {
    {}
  } else {
    stryCov_9fa48("609");
    const safeDir = (stryMutAct_9fa48("612") ? repoDir !== "." : stryMutAct_9fa48("611") ? false : stryMutAct_9fa48("610") ? true : (stryCov_9fa48("610", "611", "612"), repoDir === (stryMutAct_9fa48("613") ? "" : (stryCov_9fa48("613"), ".")))) ? stryMutAct_9fa48("614") ? "" : (stryCov_9fa48("614"), "root") : repoDir;
    return path.join(manifestsRoot(cwd), safeDir, stryMutAct_9fa48("615") ? "" : (stryCov_9fa48("615"), "versions.json"));
  }
}
export function stateDir(cwd: string): string {
  if (stryMutAct_9fa48("616")) {
    {}
  } else {
    stryCov_9fa48("616");
    return path.join(integrityRoot(cwd), stryMutAct_9fa48("617") ? "" : (stryCov_9fa48("617"), "state"));
  }
}
export function deletedLogPath(cwd: string): string {
  if (stryMutAct_9fa48("618")) {
    {}
  } else {
    stryCov_9fa48("618");
    return path.join(stateDir(cwd), stryMutAct_9fa48("619") ? "" : (stryCov_9fa48("619"), "deleted-log.json"));
  }
}
export function movedLogPath(cwd: string): string {
  if (stryMutAct_9fa48("620")) {
    {}
  } else {
    stryCov_9fa48("620");
    return path.join(stateDir(cwd), stryMutAct_9fa48("621") ? "" : (stryCov_9fa48("621"), "moved-log.json"));
  }
}
export function buildDir(cwd: string): string {
  if (stryMutAct_9fa48("622")) {
    {}
  } else {
    stryCov_9fa48("622");
    return path.join(integrityRoot(cwd), stryMutAct_9fa48("623") ? "" : (stryCov_9fa48("623"), "build"));
  }
}
export function buildLatestDir(cwd: string): string {
  if (stryMutAct_9fa48("624")) {
    {}
  } else {
    stryCov_9fa48("624");
    return path.join(buildDir(cwd), stryMutAct_9fa48("625") ? "" : (stryCov_9fa48("625"), "latest"));
  }
}
export function outputsPath(cwd: string): string {
  if (stryMutAct_9fa48("626")) {
    {}
  } else {
    stryCov_9fa48("626");
    return path.join(buildLatestDir(cwd), stryMutAct_9fa48("627") ? "" : (stryCov_9fa48("627"), "outputs.json"));
  }
}
export function provenancePath(cwd: string): string {
  if (stryMutAct_9fa48("628")) {
    {}
  } else {
    stryCov_9fa48("628");
    return path.join(buildLatestDir(cwd), stryMutAct_9fa48("629") ? "" : (stryCov_9fa48("629"), "build-provenance.json"));
  }
}
export function signatureBinaryPath(cwd: string): string {
  if (stryMutAct_9fa48("630")) {
    {}
  } else {
    stryCov_9fa48("630");
    return path.join(buildLatestDir(cwd), stryMutAct_9fa48("631") ? "" : (stryCov_9fa48("631"), "signature.bin"));
  }
}
export function signatureHexPath(cwd: string): string {
  if (stryMutAct_9fa48("632")) {
    {}
  } else {
    stryCov_9fa48("632");
    return path.join(buildLatestDir(cwd), stryMutAct_9fa48("633") ? "" : (stryCov_9fa48("633"), "signature.hex"));
  }
}
export function signedManifestPath(cwd: string): string {
  if (stryMutAct_9fa48("634")) {
    {}
  } else {
    stryCov_9fa48("634");
    return path.join(buildLatestDir(cwd), stryMutAct_9fa48("635") ? "" : (stryCov_9fa48("635"), "signed-manifest.json"));
  }
}