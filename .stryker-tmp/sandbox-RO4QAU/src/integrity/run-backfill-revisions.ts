/*
<MODULE_CONTRACT>
<purpose>Coordinates the backfilling of revision counts for tracked entities using Git history.</purpose>
<non-goals>
  <item>Do not handle entity creation or deletion beyond revision updates.</item>
  <item>Do not perform any operations related to transport or configuration orchestration.</item>
  <item>Do not parse raw content from files or directories.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Refined the backfill process to ensure accurate revision counts for tracked entities.</item>
</CHANGE_SUMMARY>
*/
// @ts-nocheck


/**
 * Annotation revision counts from Git history for all tracked entities.
 * Updates entities and manifests with accurate revision numbers.
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
import { getFileRevisionFromHistory } from "./git.ts";
import { getManifestFileName, loadDirectoryManifest, saveDirectoryManifest, upsertManifestRecord } from "./manifests.ts";
import { readJsonFile, writeJsonFile } from "./json.ts";
import { deletedLogPath } from "./paths.ts";
import { loadEntitiesById, loadPathsCurrent, saveEntitiesById } from "./registry.ts";
import type { DeletedLogItem } from "./types.ts";
export async function runBackfillRevisions(args: {
  cwd: string;
}): Promise<void> {
  if (stryMutAct_9fa48("725")) {
    {}
  } else {
    stryCov_9fa48("725");
    const {
      cwd
    } = args;
    const entities = await loadEntitiesById(cwd);
    const paths = await loadPathsCurrent(cwd);
    const deletedLog = await readJsonFile<DeletedLogItem[]>(deletedLogPath(cwd)).catch(stryMutAct_9fa48("726") ? () => undefined : (stryCov_9fa48("726"), () => stryMutAct_9fa48("727") ? ["Stryker was here"] : (stryCov_9fa48("727"), [])));
    const deletedByEntityId = new Map(deletedLog.map(stryMutAct_9fa48("728") ? () => undefined : (stryCov_9fa48("728"), item => stryMutAct_9fa48("729") ? [] : (stryCov_9fa48("729"), [item.entityId, item]))));
    const manifestCache = new Map<string, Awaited<ReturnType<typeof loadDirectoryManifest>>>();
    let updatedEntities = 0;
    let updatedActiveRecords = 0;
    let updatedDeletedLog = 0;
    for (const [entityId, entity] of Object.entries(entities)) {
      if (stryMutAct_9fa48("730")) {
        {}
      } else {
        stryCov_9fa48("730");
        const repoPath = entity.currentPath;
        if (stryMutAct_9fa48("733") ? false : stryMutAct_9fa48("732") ? true : stryMutAct_9fa48("731") ? repoPath : (stryCov_9fa48("731", "732", "733"), !repoPath)) {
          if (stryMutAct_9fa48("734")) {
            {}
          } else {
            stryCov_9fa48("734");
            continue;
          }
        }
        const revision = await getFileRevisionFromHistory(cwd, repoPath);
        if (stryMutAct_9fa48("737") ? revision !== entity.revision : stryMutAct_9fa48("736") ? false : stryMutAct_9fa48("735") ? true : (stryCov_9fa48("735", "736", "737"), revision === entity.revision)) {
          if (stryMutAct_9fa48("738")) {
            {}
          } else {
            stryCov_9fa48("738");
            continue;
          }
        }
        entity.revision = revision;
        stryMutAct_9fa48("739") ? updatedEntities -= 1 : (stryCov_9fa48("739"), updatedEntities += 1);
        const deletedItem = deletedByEntityId.get(entityId);
        if (stryMutAct_9fa48("741") ? false : stryMutAct_9fa48("740") ? true : (stryCov_9fa48("740", "741"), deletedItem)) {
          if (stryMutAct_9fa48("742")) {
            {}
          } else {
            stryCov_9fa48("742");
            deletedItem.lastRevision = revision;
            stryMutAct_9fa48("743") ? updatedDeletedLog -= 1 : (stryCov_9fa48("743"), updatedDeletedLog += 1);
          }
        }
        if (stryMutAct_9fa48("746") ? entity.status !== "active" && paths[repoPath] !== entityId : stryMutAct_9fa48("745") ? false : stryMutAct_9fa48("744") ? true : (stryCov_9fa48("744", "745", "746"), (stryMutAct_9fa48("748") ? entity.status === "active" : stryMutAct_9fa48("747") ? false : (stryCov_9fa48("747", "748"), entity.status !== (stryMutAct_9fa48("749") ? "" : (stryCov_9fa48("749"), "active")))) || (stryMutAct_9fa48("751") ? paths[repoPath] === entityId : stryMutAct_9fa48("750") ? false : (stryCov_9fa48("750", "751"), paths[repoPath] !== entityId)))) {
          if (stryMutAct_9fa48("752")) {
            {}
          } else {
            stryCov_9fa48("752");
            continue;
          }
        }
        const repoDir = path.posix.dirname(repoPath);
        const fileName = getManifestFileName(repoPath);
        let manifest = manifestCache.get(repoDir);
        if (stryMutAct_9fa48("755") ? manifest !== undefined : stryMutAct_9fa48("754") ? false : stryMutAct_9fa48("753") ? true : (stryCov_9fa48("753", "754", "755"), manifest === undefined)) {
          if (stryMutAct_9fa48("756")) {
            {}
          } else {
            stryCov_9fa48("756");
            manifest = await loadDirectoryManifest(cwd, repoDir);
            if (stryMutAct_9fa48("757")) {
              ;
            } else {
              stryCov_9fa48("757");
              manifestCache.set(repoDir, manifest);
            }
          }
        }
        if (stryMutAct_9fa48("760") ? false : stryMutAct_9fa48("759") ? true : stryMutAct_9fa48("758") ? manifest : (stryCov_9fa48("758", "759", "760"), !manifest)) {
          if (stryMutAct_9fa48("761")) {
            {}
          } else {
            stryCov_9fa48("761");
            continue;
          }
        }
        upsertManifestRecord(manifest, fileName, stryMutAct_9fa48("763") ? {} : (stryCov_9fa48("763"), {
          entityId,
          createdAt: entity.createdAt,
          updatedAt: entity.updatedAt,
          revision: entity.revision,
          contentHash: entity.contentHash,
          gitSha: entity.gitSha,
          status: entity.status
        }));
        stryMutAct_9fa48("764") ? updatedActiveRecords -= 1 : (stryCov_9fa48("764"), updatedActiveRecords += 1);
      }
    }
    await saveEntitiesById(cwd, entities);
    await Promise.all(stryMutAct_9fa48("765") ? Array.from(manifestCache.values()).map(manifest => saveDirectoryManifest(cwd, manifest)) : (stryCov_9fa48("765"), Array.from(manifestCache.values()).filter(stryMutAct_9fa48("766") ? () => undefined : (stryCov_9fa48("766"), (manifest): manifest is NonNullable<typeof manifest> => Boolean(manifest))).map(stryMutAct_9fa48("767") ? () => undefined : (stryCov_9fa48("767"), manifest => saveDirectoryManifest(cwd, manifest)))));
    if (stryMutAct_9fa48("771") ? updatedDeletedLog <= 0 : stryMutAct_9fa48("770") ? updatedDeletedLog >= 0 : stryMutAct_9fa48("769") ? false : stryMutAct_9fa48("768") ? true : (stryCov_9fa48("768", "769", "770", "771"), updatedDeletedLog > 0)) {
      if (stryMutAct_9fa48("772")) {
        {}
      } else {
        stryCov_9fa48("772");
        await writeJsonFile(deletedLogPath(cwd), deletedLog);
      }
    }
    console.log(stryMutAct_9fa48("774") ? "Stryker was here!" : (stryCov_9fa48("774"), ""));
    console.log(stryMutAct_9fa48("776") ? "" : (stryCov_9fa48("776"), "Integrity revision backfill"));
    console.log(stryMutAct_9fa48("778") ? `` : (stryCov_9fa48("778"), `  updated entities      ${updatedEntities}`));
    console.log(stryMutAct_9fa48("780") ? `` : (stryCov_9fa48("780"), `  updated manifest rows ${updatedActiveRecords}`));
    console.log(stryMutAct_9fa48("782") ? `` : (stryCov_9fa48("782"), `  updated deleted log   ${updatedDeletedLog}`));
  }
}