/* 
<MODULE_CONTRACT>
<purpose>Facilitates the synchronization of integrity manifests with file system changes.</purpose>
<non-goals>
  <item>Do not handle raw file parsing or content validation.</item>
  <item>Do not manage external configuration or transport orchestration.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Migrated sha256FileHex from deleted ./hash.ts to byteHashFile from @warpgogol/fingerprint directly.</item>
</CHANGE_SUMMARY>
*/
// @ts-nocheck


/**
 * Update integrity manifests after file system changes.
 * Processes Git changes to update entities, manifests, and path bindings.
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
import { discoverManagedFiles } from "./discover.ts";
import { getChangedPaths, getFileHistory } from "./git.ts";
import { readJsonFile, writeJsonFile } from "./json.ts";
import { createEmptyManifest, getManifestFileName, loadDirectoryManifest, removeManifestRecord, saveDirectoryManifest, upsertManifestRecord } from "./manifests.ts";
import { deletedLogPath } from "./paths.ts";
import { loadEntitiesById, loadPathsCurrent, saveEntitiesById, savePathsCurrent } from "./registry.ts";
import { detectMoves } from "./move-detection.ts";
import { v7 as uuidv7 } from "uuid";
import type { DeletedLogItem, DirectoryManifest, EntitiesById, ManifestFileRecord, MoveCandidate, PathsCurrent, RegistryEntity } from "./types.ts";
function uniqueSorted(values: Iterable<string>): string[] {
  if (stryMutAct_9fa48("826")) {
    {}
  } else {
    stryCov_9fa48("826");
    return stryMutAct_9fa48("827") ? Array.from(new Set(values)) : (stryCov_9fa48("827"), Array.from(new Set(values)).sort(stryMutAct_9fa48("828") ? () => undefined : (stryCov_9fa48("828"), (a, b) => a.localeCompare(b))));
  }
}
async function findOutOfSyncActivePaths(args: {
  cwd: string;
  entities: EntitiesById;
  paths: PathsCurrent;
  currentManagedFiles: string[];
}): Promise<string[]> {
  if (stryMutAct_9fa48("829")) {
    {}
  } else {
    stryCov_9fa48("829");
    const {
      cwd,
      entities,
      paths,
      currentManagedFiles
    } = args;
    const outOfSyncPaths: string[] = stryMutAct_9fa48("830") ? ["Stryker was here"] : (stryCov_9fa48("830"), []);
    for (const repoPath of currentManagedFiles) {
      if (stryMutAct_9fa48("831")) {
        {}
      } else {
        stryCov_9fa48("831");
        const entityId = paths[repoPath];
        if (stryMutAct_9fa48("834") ? false : stryMutAct_9fa48("833") ? true : stryMutAct_9fa48("832") ? entityId : (stryCov_9fa48("832", "833", "834"), !entityId)) {
          if (stryMutAct_9fa48("835")) {
            {}
          } else {
            stryCov_9fa48("835");
            continue;
          }
        }
        const entity = entities[entityId];
        if (stryMutAct_9fa48("838") ? !entity && entity.status !== "active" : stryMutAct_9fa48("837") ? false : stryMutAct_9fa48("836") ? true : (stryCov_9fa48("836", "837", "838"), (stryMutAct_9fa48("839") ? entity : (stryCov_9fa48("839"), !entity)) || (stryMutAct_9fa48("841") ? entity.status === "active" : stryMutAct_9fa48("840") ? false : (stryCov_9fa48("840", "841"), entity.status !== (stryMutAct_9fa48("842") ? "" : (stryCov_9fa48("842"), "active")))))) {
          if (stryMutAct_9fa48("843")) {
            {}
          } else {
            stryCov_9fa48("843");
            continue;
          }
        }
        const actualHash = await byteHashFile(path.join(cwd, repoPath)).catch(stryMutAct_9fa48("844") ? () => undefined : (stryCov_9fa48("844"), () => null));
        if (stryMutAct_9fa48("847") ? !actualHash && actualHash === entity.contentHash : stryMutAct_9fa48("846") ? false : stryMutAct_9fa48("845") ? true : (stryCov_9fa48("845", "846", "847"), (stryMutAct_9fa48("848") ? actualHash : (stryCov_9fa48("848"), !actualHash)) || (stryMutAct_9fa48("850") ? actualHash !== entity.contentHash : stryMutAct_9fa48("849") ? false : (stryCov_9fa48("849", "850"), actualHash === entity.contentHash)))) {
          if (stryMutAct_9fa48("851")) {
            {}
          } else {
            stryCov_9fa48("851");
            continue;
          }
        }
        if (stryMutAct_9fa48("852")) {
          ;
        } else {
          stryCov_9fa48("852");
          outOfSyncPaths.push(repoPath);
        }
      }
    }
    return outOfSyncPaths;
  }
}
function entityToManifestRecord(entityId: string, entity: RegistryEntity): ManifestFileRecord {
  if (stryMutAct_9fa48("853")) {
    {}
  } else {
    stryCov_9fa48("853");
    return stryMutAct_9fa48("854") ? {} : (stryCov_9fa48("854"), {
      entityId,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
      revision: entity.revision,
      contentHash: entity.contentHash,
      gitSha: entity.gitSha,
      status: entity.status
    });
  }
}
async function loadDeletedLog(cwd: string): Promise<DeletedLogItem[]> {
  if (stryMutAct_9fa48("855")) {
    {}
  } else {
    stryCov_9fa48("855");
    return readJsonFile<DeletedLogItem[]>(deletedLogPath(cwd)).catch(stryMutAct_9fa48("856") ? () => undefined : (stryCov_9fa48("856"), () => stryMutAct_9fa48("857") ? ["Stryker was here"] : (stryCov_9fa48("857"), [])));
  }
}
function createManifestStore(cwd: string) {
  if (stryMutAct_9fa48("858")) {
    {}
  } else {
    stryCov_9fa48("858");
    const cache = new Map<string, DirectoryManifest>();
    return stryMutAct_9fa48("859") ? {} : (stryCov_9fa48("859"), {
      async get(repoDir: string): Promise<DirectoryManifest> {
        if (stryMutAct_9fa48("860")) {
          {}
        } else {
          stryCov_9fa48("860");
          const existing = cache.get(repoDir);
          if (stryMutAct_9fa48("862") ? false : stryMutAct_9fa48("861") ? true : (stryCov_9fa48("861", "862"), existing)) return existing;
          const loaded = stryMutAct_9fa48("863") ? (await loadDirectoryManifest(cwd, repoDir)) && createEmptyManifest(repoDir) : (stryCov_9fa48("863"), (await loadDirectoryManifest(cwd, repoDir)) ?? createEmptyManifest(repoDir));
          if (stryMutAct_9fa48("864")) {
            ;
          } else {
            stryCov_9fa48("864");
            cache.set(repoDir, loaded);
          }
          return loaded;
        }
      },
      async saveAll(): Promise<void> {
        if (stryMutAct_9fa48("865")) {
          {}
        } else {
          stryCov_9fa48("865");
          for (const manifest of cache.values()) {
            if (stryMutAct_9fa48("866")) {
              {}
            } else {
              stryCov_9fa48("866");
              await saveDirectoryManifest(cwd, manifest);
            }
          }
        }
      }
    });
  }
}
async function moveEntity(args: {
  cwd: string;
  entities: EntitiesById;
  paths: PathsCurrent;
  manifestStore: ReturnType<typeof createManifestStore>;
  move: MoveCandidate;
}): Promise<void> {
  if (stryMutAct_9fa48("867")) {
    {}
  } else {
    stryCov_9fa48("867");
    const {
      cwd,
      entities,
      paths,
      manifestStore,
      move
    } = args;
    const entity = entities[move.entityId];
    if (stryMutAct_9fa48("870") ? false : stryMutAct_9fa48("869") ? true : stryMutAct_9fa48("868") ? entity : (stryCov_9fa48("868", "869", "870"), !entity)) return;
    const oldPath = move.from;
    const newPath = move.to;
    const oldHash = entity.contentHash;
    const absNewPath = path.join(cwd, newPath);
    const nextHash = await byteHashFile(absNewPath).catch(stryMutAct_9fa48("871") ? () => undefined : (stryCov_9fa48("871"), () => oldHash));
    const history = await getFileHistory(cwd, newPath);
    const now = new Date().toISOString();
    const isContentChange = stryMutAct_9fa48("874") ? nextHash === oldHash : stryMutAct_9fa48("873") ? false : stryMutAct_9fa48("872") ? true : (stryCov_9fa48("872", "873", "874"), nextHash !== oldHash);
    entity.currentPath = newPath;
    entity.status = stryMutAct_9fa48("875") ? "" : (stryCov_9fa48("875"), "active");
    entity.gitSha = stryMutAct_9fa48("876") ? history.lastCommitSha && entity.gitSha : (stryCov_9fa48("876"), history.lastCommitSha ?? entity.gitSha);
    if (stryMutAct_9fa48("878") ? false : stryMutAct_9fa48("877") ? true : (stryCov_9fa48("877", "878"), isContentChange)) {
      if (stryMutAct_9fa48("879")) {
        {}
      } else {
        stryCov_9fa48("879");
        entity.contentHash = nextHash;
        entity.updatedAt = stryMutAct_9fa48("880") ? history.updatedAt && now : (stryCov_9fa48("880"), history.updatedAt ?? now);
        stryMutAct_9fa48("881") ? entity.revision -= 1 : (stryCov_9fa48("881"), entity.revision += 1);
      }
    }
    entity.moves = stryMutAct_9fa48("882") ? entity.moves && [] : (stryCov_9fa48("882"), entity.moves ?? (stryMutAct_9fa48("883") ? ["Stryker was here"] : (stryCov_9fa48("883"), [])));
    entity.moves.push(stryMutAct_9fa48("885") ? {} : (stryCov_9fa48("885"), {
      from: oldPath,
      to: newPath,
      detectedAt: now,
      confidence: move.confidence,
      method: move.method
    }));
    delete paths[oldPath];
    paths[newPath] = move.entityId;
    const oldDir = path.posix.dirname(oldPath);
    const newDir = path.posix.dirname(newPath);
    const oldFileName = getManifestFileName(oldPath);
    const newFileName = getManifestFileName(newPath);
    const oldManifest = await manifestStore.get(oldDir);
    if (stryMutAct_9fa48("886")) {
      ;
    } else {
      stryCov_9fa48("886");
      removeManifestRecord(oldManifest, oldFileName);
    }
    const newManifest = await manifestStore.get(newDir);
    if (stryMutAct_9fa48("887")) {
      ;
    } else {
      stryCov_9fa48("887");
      upsertManifestRecord(newManifest, newFileName, entityToManifestRecord(move.entityId, entity));
    }
  }
}
async function markDeleted(args: {
  entities: EntitiesById;
  paths: PathsCurrent;
  deletedLog: DeletedLogItem[];
  manifestStore: ReturnType<typeof createManifestStore>;
  repoPath: string;
}): Promise<void> {
  if (stryMutAct_9fa48("888")) {
    {}
  } else {
    stryCov_9fa48("888");
    const {
      entities,
      paths,
      deletedLog,
      manifestStore,
      repoPath
    } = args;
    const entityId = paths[repoPath];
    if (stryMutAct_9fa48("891") ? false : stryMutAct_9fa48("890") ? true : stryMutAct_9fa48("889") ? entityId : (stryCov_9fa48("889", "890", "891"), !entityId)) return;
    const entity = entities[entityId];
    if (stryMutAct_9fa48("894") ? false : stryMutAct_9fa48("893") ? true : stryMutAct_9fa48("892") ? entity : (stryCov_9fa48("892", "893", "894"), !entity)) return;
    entity.status = stryMutAct_9fa48("895") ? "" : (stryCov_9fa48("895"), "deleted");
    delete paths[repoPath];
    deletedLog.push(stryMutAct_9fa48("897") ? {} : (stryCov_9fa48("897"), {
      entityId,
      lastPath: repoPath,
      deletedAt: new Date().toISOString(),
      lastRevision: entity.revision,
      lastHash: entity.contentHash
    }));
    const repoDir = path.posix.dirname(repoPath);
    const fileName = getManifestFileName(repoPath);
    const manifest = await manifestStore.get(repoDir);
    if (stryMutAct_9fa48("898")) {
      ;
    } else {
      stryCov_9fa48("898");
      removeManifestRecord(manifest, fileName);
    }
  }
}
async function addNewEntity(args: {
  cwd: string;
  entities: EntitiesById;
  paths: PathsCurrent;
  manifestStore: ReturnType<typeof createManifestStore>;
  repoPath: string;
}): Promise<void> {
  if (stryMutAct_9fa48("899")) {
    {}
  } else {
    stryCov_9fa48("899");
    const {
      cwd,
      entities,
      paths,
      manifestStore,
      repoPath
    } = args;
    const absPath = path.join(cwd, repoPath);
    const hash = await byteHashFile(absPath);
    const history = await getFileHistory(cwd, repoPath);
    const now = new Date().toISOString();
    const entityId = uuidv7();
    entities[entityId] = stryMutAct_9fa48("900") ? {} : (stryCov_9fa48("900"), {
      currentPath: repoPath,
      firstPath: repoPath,
      createdAt: stryMutAct_9fa48("901") ? history.createdAt && now : (stryCov_9fa48("901"), history.createdAt ?? now),
      updatedAt: stryMutAct_9fa48("902") ? history.updatedAt && now : (stryCov_9fa48("902"), history.updatedAt ?? now),
      revision: 1,
      contentHash: hash,
      gitSha: stryMutAct_9fa48("903") ? history.lastCommitSha && "unknown" : (stryCov_9fa48("903"), history.lastCommitSha ?? (stryMutAct_9fa48("904") ? "" : (stryCov_9fa48("904"), "unknown"))),
      status: stryMutAct_9fa48("905") ? "" : (stryCov_9fa48("905"), "active"),
      moves: stryMutAct_9fa48("906") ? ["Stryker was here"] : (stryCov_9fa48("906"), [])
    });
    paths[repoPath] = entityId;
    const repoDir = path.posix.dirname(repoPath);
    const fileName = getManifestFileName(repoPath);
    const manifest = await manifestStore.get(repoDir);
    if (stryMutAct_9fa48("907")) {
      ;
    } else {
      stryCov_9fa48("907");
      upsertManifestRecord(manifest, fileName, entityToManifestRecord(entityId, entities[entityId]));
    }
  }
}
async function updateModifiedEntity(args: {
  cwd: string;
  entities: EntitiesById;
  paths: PathsCurrent;
  manifestStore: ReturnType<typeof createManifestStore>;
  repoPath: string;
}): Promise<void> {
  if (stryMutAct_9fa48("908")) {
    {}
  } else {
    stryCov_9fa48("908");
    const {
      cwd,
      entities,
      paths,
      manifestStore,
      repoPath
    } = args;
    const entityId = paths[repoPath];
    if (stryMutAct_9fa48("911") ? false : stryMutAct_9fa48("910") ? true : stryMutAct_9fa48("909") ? entityId : (stryCov_9fa48("909", "910", "911"), !entityId)) return;
    const entity = entities[entityId];
    if (stryMutAct_9fa48("914") ? !entity && entity.status !== "active" : stryMutAct_9fa48("913") ? false : stryMutAct_9fa48("912") ? true : (stryCov_9fa48("912", "913", "914"), (stryMutAct_9fa48("915") ? entity : (stryCov_9fa48("915"), !entity)) || (stryMutAct_9fa48("917") ? entity.status === "active" : stryMutAct_9fa48("916") ? false : (stryCov_9fa48("916", "917"), entity.status !== (stryMutAct_9fa48("918") ? "" : (stryCov_9fa48("918"), "active")))))) return;
    const absPath = path.join(cwd, repoPath);
    const nextHash = await byteHashFile(absPath);
    if (stryMutAct_9fa48("921") ? nextHash !== entity.contentHash : stryMutAct_9fa48("920") ? false : stryMutAct_9fa48("919") ? true : (stryCov_9fa48("919", "920", "921"), nextHash === entity.contentHash)) return;
    const history = await getFileHistory(cwd, repoPath);
    entity.contentHash = nextHash;
    entity.updatedAt = stryMutAct_9fa48("922") ? history.updatedAt && new Date().toISOString() : (stryCov_9fa48("922"), history.updatedAt ?? new Date().toISOString());
    entity.gitSha = stryMutAct_9fa48("923") ? history.lastCommitSha && entity.gitSha : (stryCov_9fa48("923"), history.lastCommitSha ?? entity.gitSha);
    stryMutAct_9fa48("924") ? entity.revision -= 1 : (stryCov_9fa48("924"), entity.revision += 1);
    const repoDir = path.posix.dirname(repoPath);
    const fileName = getManifestFileName(repoPath);
    const manifest = await manifestStore.get(repoDir);
    if (stryMutAct_9fa48("925")) {
      ;
    } else {
      stryCov_9fa48("925");
      upsertManifestRecord(manifest, fileName, entityToManifestRecord(entityId, entity));
    }
  }
}
export async function runUpdate(args: {
  cwd: string;
  baseRef?: string;
}): Promise<void> {
  if (stryMutAct_9fa48("926")) {
    {}
  } else {
    stryCov_9fa48("926");
    const {
      cwd,
      baseRef
    } = args;
    const entities = await loadEntitiesById(cwd);
    const paths = await loadPathsCurrent(cwd);
    const deletedLog = await loadDeletedLog(cwd);
    const manifestStore = createManifestStore(cwd);
    const currentManagedFiles = await discoverManagedFiles(cwd);
    const currentManagedSet = new Set(currentManagedFiles);
    const changes = await getChangedPaths(cwd, baseRef);
    const outOfSyncActivePaths = await findOutOfSyncActivePaths(stryMutAct_9fa48("927") ? {} : (stryCov_9fa48("927"), {
      cwd,
      entities,
      paths,
      currentManagedFiles
    }));
    const activePaths = stryMutAct_9fa48("929") ? Object.entries(paths).map(([repoPath]) => repoPath).sort((a, b) => a.localeCompare(b)) : stryMutAct_9fa48("928") ? Object.entries(paths).filter(([, entityId]) => entities[entityId]?.status === "active").map(([repoPath]) => repoPath) : (stryCov_9fa48("928", "929"), Object.entries(paths).filter(stryMutAct_9fa48("930") ? () => undefined : (stryCov_9fa48("930"), ([, entityId]) => stryMutAct_9fa48("933") ? entities[entityId]?.status !== "active" : stryMutAct_9fa48("932") ? false : stryMutAct_9fa48("931") ? true : (stryCov_9fa48("931", "932", "933"), (stryMutAct_9fa48("934") ? entities[entityId].status : (stryCov_9fa48("934"), entities[entityId]?.status)) === (stryMutAct_9fa48("935") ? "" : (stryCov_9fa48("935"), "active"))))).map(stryMutAct_9fa48("936") ? () => undefined : (stryCov_9fa48("936"), ([repoPath]) => repoPath)).sort(stryMutAct_9fa48("937") ? () => undefined : (stryCov_9fa48("937"), (a, b) => a.localeCompare(b))));
    const deletedCandidates = stryMutAct_9fa48("938") ? uniqueSorted([...changes.deleted, ...activePaths.filter(repoPath => !currentManagedSet.has(repoPath))]) : (stryCov_9fa48("938"), uniqueSorted(stryMutAct_9fa48("939") ? [] : (stryCov_9fa48("939"), [...changes.deleted, ...(stryMutAct_9fa48("940") ? activePaths : (stryCov_9fa48("940"), activePaths.filter(stryMutAct_9fa48("941") ? () => undefined : (stryCov_9fa48("941"), repoPath => stryMutAct_9fa48("942") ? currentManagedSet.has(repoPath) : (stryCov_9fa48("942"), !currentManagedSet.has(repoPath))))))])).filter(stryMutAct_9fa48("943") ? () => undefined : (stryCov_9fa48("943"), repoPath => paths[repoPath])));
    const addedCandidates = stryMutAct_9fa48("944") ? uniqueSorted([...changes.added, ...currentManagedFiles.filter(repoPath => !paths[repoPath])]) : (stryCov_9fa48("944"), uniqueSorted(stryMutAct_9fa48("945") ? [] : (stryCov_9fa48("945"), [...changes.added, ...(stryMutAct_9fa48("946") ? currentManagedFiles : (stryCov_9fa48("946"), currentManagedFiles.filter(stryMutAct_9fa48("947") ? () => undefined : (stryCov_9fa48("947"), repoPath => stryMutAct_9fa48("948") ? paths[repoPath] : (stryCov_9fa48("948"), !paths[repoPath])))))])).filter(stryMutAct_9fa48("949") ? () => undefined : (stryCov_9fa48("949"), repoPath => currentManagedSet.has(repoPath))));
    const modifiedCandidates = stryMutAct_9fa48("950") ? uniqueSorted([...changes.modified, ...changes.renamed.map(item => item.to), ...outOfSyncActivePaths]) : (stryCov_9fa48("950"), uniqueSorted(stryMutAct_9fa48("951") ? [] : (stryCov_9fa48("951"), [...changes.modified, ...changes.renamed.map(stryMutAct_9fa48("952") ? () => undefined : (stryCov_9fa48("952"), item => item.to)), ...outOfSyncActivePaths])).filter(stryMutAct_9fa48("953") ? () => undefined : (stryCov_9fa48("953"), repoPath => stryMutAct_9fa48("956") ? currentManagedSet.has(repoPath) || Boolean(paths[repoPath]) : stryMutAct_9fa48("955") ? false : stryMutAct_9fa48("954") ? true : (stryCov_9fa48("954", "955", "956"), currentManagedSet.has(repoPath) && Boolean(paths[repoPath])))));
    const matchedDeleted = new Set<string>();
    const matchedAdded = new Set<string>();
    const explicitMoves: MoveCandidate[] = stryMutAct_9fa48("957") ? changes.renamed.map(({
      from,
      to
    }) => ({
      entityId: paths[from],
      from,
      to,
      confidence: 1,
      method: "heuristic"
    })) : (stryCov_9fa48("957"), changes.renamed.filter(stryMutAct_9fa48("958") ? () => undefined : (stryCov_9fa48("958"), ({
      from,
      to
    }) => stryMutAct_9fa48("961") ? Boolean(paths[from]) || currentManagedSet.has(to) : stryMutAct_9fa48("960") ? false : stryMutAct_9fa48("959") ? true : (stryCov_9fa48("959", "960", "961"), Boolean(paths[from]) && currentManagedSet.has(to)))).map(stryMutAct_9fa48("962") ? () => undefined : (stryCov_9fa48("962"), ({
      from,
      to
    }) => stryMutAct_9fa48("963") ? {} : (stryCov_9fa48("963"), {
      entityId: paths[from],
      from,
      to,
      confidence: 1,
      method: stryMutAct_9fa48("964") ? "" : (stryCov_9fa48("964"), "heuristic")
    }))));
    for (const move of explicitMoves) {
      if (stryMutAct_9fa48("965")) {
        {}
      } else {
        stryCov_9fa48("965");
        if (stryMutAct_9fa48("968") ? matchedDeleted.has(move.from) && matchedAdded.has(move.to) : stryMutAct_9fa48("967") ? false : stryMutAct_9fa48("966") ? true : (stryCov_9fa48("966", "967", "968"), matchedDeleted.has(move.from) || matchedAdded.has(move.to))) continue;
        await moveEntity(stryMutAct_9fa48("969") ? {} : (stryCov_9fa48("969"), {
          cwd,
          entities,
          paths,
          manifestStore,
          move
        }));
        if (stryMutAct_9fa48("970")) {
          ;
        } else {
          stryCov_9fa48("970");
          matchedDeleted.add(move.from);
        }
        if (stryMutAct_9fa48("971")) {
          ;
        } else {
          stryCov_9fa48("971");
          matchedAdded.add(move.to);
        }
      }
    }
    const inferredMoves = await detectMoves(stryMutAct_9fa48("972") ? {} : (stryCov_9fa48("972"), {
      cwd,
      deletedPaths: stryMutAct_9fa48("973") ? deletedCandidates : (stryCov_9fa48("973"), deletedCandidates.filter(stryMutAct_9fa48("974") ? () => undefined : (stryCov_9fa48("974"), repoPath => stryMutAct_9fa48("975") ? matchedDeleted.has(repoPath) : (stryCov_9fa48("975"), !matchedDeleted.has(repoPath))))),
      addedPaths: stryMutAct_9fa48("976") ? addedCandidates : (stryCov_9fa48("976"), addedCandidates.filter(stryMutAct_9fa48("977") ? () => undefined : (stryCov_9fa48("977"), repoPath => stryMutAct_9fa48("978") ? matchedAdded.has(repoPath) : (stryCov_9fa48("978"), !matchedAdded.has(repoPath)))))
    }));
    for (const move of inferredMoves) {
      if (stryMutAct_9fa48("979")) {
        {}
      } else {
        stryCov_9fa48("979");
        if (stryMutAct_9fa48("982") ? matchedDeleted.has(move.from) && matchedAdded.has(move.to) : stryMutAct_9fa48("981") ? false : stryMutAct_9fa48("980") ? true : (stryCov_9fa48("980", "981", "982"), matchedDeleted.has(move.from) || matchedAdded.has(move.to))) continue;
        await moveEntity(stryMutAct_9fa48("983") ? {} : (stryCov_9fa48("983"), {
          cwd,
          entities,
          paths,
          manifestStore,
          move
        }));
        if (stryMutAct_9fa48("984")) {
          ;
        } else {
          stryCov_9fa48("984");
          matchedDeleted.add(move.from);
        }
        if (stryMutAct_9fa48("985")) {
          ;
        } else {
          stryCov_9fa48("985");
          matchedAdded.add(move.to);
        }
      }
    }
    for (const repoPath of deletedCandidates) {
      if (stryMutAct_9fa48("986")) {
        {}
      } else {
        stryCov_9fa48("986");
        if (stryMutAct_9fa48("988") ? false : stryMutAct_9fa48("987") ? true : (stryCov_9fa48("987", "988"), matchedDeleted.has(repoPath))) continue;
        await markDeleted(stryMutAct_9fa48("989") ? {} : (stryCov_9fa48("989"), {
          entities,
          paths,
          deletedLog,
          manifestStore,
          repoPath
        }));
      }
    }
    for (const repoPath of addedCandidates) {
      if (stryMutAct_9fa48("990")) {
        {}
      } else {
        stryCov_9fa48("990");
        if (stryMutAct_9fa48("992") ? false : stryMutAct_9fa48("991") ? true : (stryCov_9fa48("991", "992"), matchedAdded.has(repoPath))) continue;
        await addNewEntity(stryMutAct_9fa48("993") ? {} : (stryCov_9fa48("993"), {
          cwd,
          entities,
          paths,
          manifestStore,
          repoPath
        }));
      }
    }
    for (const repoPath of modifiedCandidates) {
      if (stryMutAct_9fa48("994")) {
        {}
      } else {
        stryCov_9fa48("994");
        if (stryMutAct_9fa48("997") ? false : stryMutAct_9fa48("996") ? true : stryMutAct_9fa48("995") ? paths[repoPath] : (stryCov_9fa48("995", "996", "997"), !paths[repoPath])) continue;
        await updateModifiedEntity(stryMutAct_9fa48("998") ? {} : (stryCov_9fa48("998"), {
          cwd,
          entities,
          paths,
          manifestStore,
          repoPath
        }));
      }
    }
    await manifestStore.saveAll();
    await saveEntitiesById(cwd, entities);
    await savePathsCurrent(cwd, paths);
    await writeJsonFile(deletedLogPath(cwd), deletedLog);
    console.log(stryMutAct_9fa48("1000") ? "Stryker was here!" : (stryCov_9fa48("1000"), ""));
    console.log(stryMutAct_9fa48("1002") ? "" : (stryCov_9fa48("1002"), "Integrity update"));
    console.log(stryMutAct_9fa48("1004") ? `` : (stryCov_9fa48("1004"), `  base ref  ${stryMutAct_9fa48("1005") ? baseRef && "(working tree)" : (stryCov_9fa48("1005"), baseRef ?? (stryMutAct_9fa48("1006") ? "" : (stryCov_9fa48("1006"), "(working tree)")))}`));
    console.log(stryMutAct_9fa48("1008") ? `` : (stryCov_9fa48("1008"), `  added     ${stryMutAct_9fa48("1009") ? addedCandidates.length + matchedAdded.size : (stryCov_9fa48("1009"), addedCandidates.length - matchedAdded.size)}`));
    console.log(stryMutAct_9fa48("1011") ? `` : (stryCov_9fa48("1011"), `  deleted   ${stryMutAct_9fa48("1012") ? deletedCandidates.length + matchedDeleted.size : (stryCov_9fa48("1012"), deletedCandidates.length - matchedDeleted.size)}`));
    console.log(stryMutAct_9fa48("1014") ? `` : (stryCov_9fa48("1014"), `  moved     ${matchedAdded.size}`));
    console.log(stryMutAct_9fa48("1016") ? `` : (stryCov_9fa48("1016"), `  modified  ${modifiedCandidates.length}`));
  }
}