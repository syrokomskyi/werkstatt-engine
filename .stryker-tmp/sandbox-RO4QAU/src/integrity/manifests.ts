/******************************************************************************* 
<MODULE_CONTRACT> 
<purpose>Facilitates the management of directory manifests to ensure integrity and version tracking of files within specified directories.</purpose> 
 
 
<non-goals> 
  <item>Do not parse raw content of manifest files or enforce schema validation.</item> 
  <item>Do not manage the orchestration of transport or configuration settings.</item> 
</non-goals> 
</MODULE_CONTRACT> 
 
<CHANGE_SUMMARY>
  <item>Enhance Compass scaffolding to accurately reflect the functionality of directory manifest management.</item>
</CHANGE_SUMMARY> 
*******************************************************************************/
// @ts-nocheck


/**
 * Directory manifest management for integrity tracking.
 * Loads, saves, and updates per-directory file version manifests.
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
import { pathExists } from "./fs.ts";
import { readJsonFile, writeJsonFile } from "./json.ts";
import { manifestPathForDirectory } from "./paths.ts";
import type { DirectoryManifest, ManifestFileRecord } from "./types.ts";
export async function loadDirectoryManifest(cwd: string, repoDir: string): Promise<DirectoryManifest | null> {
  if (stryMutAct_9fa48("542")) {
    {}
  } else {
    stryCov_9fa48("542");
    const filePath = manifestPathForDirectory(cwd, repoDir);
    if (stryMutAct_9fa48("545") ? false : stryMutAct_9fa48("544") ? true : stryMutAct_9fa48("543") ? await pathExists(filePath) : (stryCov_9fa48("543", "544", "545"), !(await pathExists(filePath)))) return null;
    return readJsonFile<DirectoryManifest>(filePath);
  }
}
export async function saveDirectoryManifest(cwd: string, manifest: DirectoryManifest): Promise<void> {
  if (stryMutAct_9fa48("546")) {
    {}
  } else {
    stryCov_9fa48("546");
    const filePath = manifestPathForDirectory(cwd, manifest.directory);
    await writeJsonFile(filePath, manifest);
  }
}
export function createEmptyManifest(repoDir: string): DirectoryManifest {
  if (stryMutAct_9fa48("547")) {
    {}
  } else {
    stryCov_9fa48("547");
    return stryMutAct_9fa48("548") ? {} : (stryCov_9fa48("548"), {
      $schemaVersion: 1,
      directory: repoDir,
      generatedAt: new Date().toISOString(),
      files: {}
    });
  }
}
export function upsertManifestRecord(manifest: DirectoryManifest, fileName: string, record: ManifestFileRecord): DirectoryManifest {
  if (stryMutAct_9fa48("549")) {
    {}
  } else {
    stryCov_9fa48("549");
    manifest.files[fileName] = record;
    manifest.generatedAt = new Date().toISOString();
    return manifest;
  }
}
export function removeManifestRecord(manifest: DirectoryManifest, fileName: string): DirectoryManifest {
  if (stryMutAct_9fa48("550")) {
    {}
  } else {
    stryCov_9fa48("550");
    delete manifest.files[fileName];
    manifest.generatedAt = new Date().toISOString();
    return manifest;
  }
}
export function getManifestFileName(repoPath: string): string {
  if (stryMutAct_9fa48("551")) {
    {}
  } else {
    stryCov_9fa48("551");
    return path.posix.basename(repoPath);
  }
}