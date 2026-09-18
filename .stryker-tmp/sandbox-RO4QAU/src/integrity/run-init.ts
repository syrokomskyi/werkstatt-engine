/*
<MODULE_CONTRACT>
<purpose>Establishes integrity tracking for managed files by creating necessary manifests and entity records.</purpose>
<non-goals>
  <item>Do not perform file content parsing; focus solely on metadata and integrity tracking.</item>
  <item>Do not manage the orchestration of file transport or configuration settings.</item>
  <item>Do not handle user input validation beyond the initial policy file check.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Refine Compass scaffolding to improve clarity and maintainability of the runInit function.</item>
  <item>Migrated sha256FileHex from deleted ./hash.ts to byteHashFile from @warpgogol/fingerprint directly.</item>
</CHANGE_SUMMARY>
*/
// @ts-nocheck


/**
 * Initialize integrity tracking by registering all managed files.
 * Creates manifests, entities registry, and path bindings from scratch.
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
import { byteHashFile } from "@warpgogol/werkstatt-engine/fingerprint";
import { discoverManagedFiles, groupFilesByDirectory } from "./discover.ts";
import { getFileHistory, getFileRevisionFromHistory } from "./git.ts";
import { writeJsonFile } from "./json.ts";
import { createEmptyManifest, getManifestFileName, saveDirectoryManifest, upsertManifestRecord } from "./manifests.ts";
import { deletedLogPath } from "./paths.ts";
import { saveEntitiesById, savePathsCurrent } from "./registry.ts";
import { v7 as uuidv7 } from "uuid";
import { ensurePolicyFile } from "./policy.ts";
import type { DirectoryManifest, EntitiesById, PathsCurrent } from "./types.ts";
export async function runInit(args: {
  cwd: string;
}): Promise<void> {
  if (stryMutAct_9fa48("783")) {
    {}
  } else {
    stryCov_9fa48("783");
    const {
      cwd
    } = args;
    await ensurePolicyFile(cwd);
    const files = await discoverManagedFiles(cwd);
    const grouped = await groupFilesByDirectory(files);
    const manifests = new Map<string, DirectoryManifest>();
    const entities: EntitiesById = {};
    const paths: PathsCurrent = {};
    for (const file of files) {
      if (stryMutAct_9fa48("784")) {
        {}
      } else {
        stryCov_9fa48("784");
        const absPath = path.join(cwd, file);
        const entityId = uuidv7();
        const hash = await byteHashFile(absPath);
        const [history, revision] = await Promise.all(stryMutAct_9fa48("785") ? [] : (stryCov_9fa48("785"), [getFileHistory(cwd, file), getFileRevisionFromHistory(cwd, file)]));
        const now = new Date().toISOString();
        const record = stryMutAct_9fa48("786") ? {} : (stryCov_9fa48("786"), {
          entityId,
          createdAt: stryMutAct_9fa48("787") ? history.createdAt && now : (stryCov_9fa48("787"), history.createdAt ?? now),
          updatedAt: stryMutAct_9fa48("788") ? history.updatedAt && now : (stryCov_9fa48("788"), history.updatedAt ?? now),
          revision,
          contentHash: hash,
          gitSha: stryMutAct_9fa48("789") ? history.lastCommitSha && "unknown" : (stryCov_9fa48("789"), history.lastCommitSha ?? (stryMutAct_9fa48("790") ? "" : (stryCov_9fa48("790"), "unknown"))),
          status: "active" as const
        });
        const repoDir = path.posix.dirname(file);
        const fileName = getManifestFileName(file);
        const manifest = stryMutAct_9fa48("791") ? manifests.get(repoDir) && createEmptyManifest(repoDir) : (stryCov_9fa48("791"), manifests.get(repoDir) ?? createEmptyManifest(repoDir));
        if (stryMutAct_9fa48("792")) {
          ;
        } else {
          stryCov_9fa48("792");
          upsertManifestRecord(manifest, fileName, record);
        }
        if (stryMutAct_9fa48("793")) {
          ;
        } else {
          stryCov_9fa48("793");
          manifests.set(repoDir, manifest);
        }
        entities[entityId] = stryMutAct_9fa48("794") ? {} : (stryCov_9fa48("794"), {
          currentPath: file,
          firstPath: file,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          revision: record.revision,
          contentHash: record.contentHash,
          gitSha: record.gitSha,
          status: stryMutAct_9fa48("795") ? "" : (stryCov_9fa48("795"), "active"),
          moves: stryMutAct_9fa48("796") ? ["Stryker was here"] : (stryCov_9fa48("796"), [])
        });
        paths[file] = entityId;
      }
    }
    for (const repoDir of grouped.keys()) {
      if (stryMutAct_9fa48("797")) {
        {}
      } else {
        stryCov_9fa48("797");
        const manifest = manifests.get(repoDir);
        if (stryMutAct_9fa48("799") ? false : stryMutAct_9fa48("798") ? true : (stryCov_9fa48("798", "799"), manifest)) await saveDirectoryManifest(cwd, manifest);
      }
    }
    await saveEntitiesById(cwd, entities);
    await savePathsCurrent(cwd, paths);
    await writeJsonFile(deletedLogPath(cwd), stryMutAct_9fa48("800") ? ["Stryker was here"] : (stryCov_9fa48("800"), []));
    console.log(stryMutAct_9fa48("802") ? "Stryker was here!" : (stryCov_9fa48("802"), ""));
    console.log(stryMutAct_9fa48("804") ? "" : (stryCov_9fa48("804"), "Integrity init"));
    console.log(stryMutAct_9fa48("806") ? `` : (stryCov_9fa48("806"), `  managed files       ${files.length}`));
    console.log(stryMutAct_9fa48("808") ? `` : (stryCov_9fa48("808"), `  managed directories ${grouped.size}`));
    console.log(stryMutAct_9fa48("810") ? `` : (stryCov_9fa48("810"), `  registered entities ${Object.keys(entities).length}`));
  }
}