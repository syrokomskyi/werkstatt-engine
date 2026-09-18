/*
<MODULE_CONTRACT>
<purpose>Enables identification of file moves and renames by comparing content hashes, supporting integrity verification.</purpose>
<non-goals>
  <item>Do not perform raw content parsing or analysis beyond hash computation.</item>
  <item>Do not manage file system state or configurations outside of move detection.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Refine Compass scaffolding to accurately reflect the file's architectural role and responsibilities.</item>
  <item>Migrated sha256FileHex from deleted ./hash.ts to byteHashFile from @warpgogol/fingerprint directly.</item>
</CHANGE_SUMMARY>
*/
// @ts-nocheck


/**
 * Detect file moves and renames by matching content hashes.
 * Matches deleted and added files to identify moves without content changes.
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
import { loadEntitiesById } from "./registry.ts";
import type { MoveCandidate } from "./types.ts";
export async function detectMoves(args: {
  cwd: string;
  deletedPaths: string[];
  addedPaths: string[];
}): Promise<MoveCandidate[]> {
  if (stryMutAct_9fa48("559")) {
    {}
  } else {
    stryCov_9fa48("559");
    const {
      cwd,
      deletedPaths,
      addedPaths
    } = args;
    if (stryMutAct_9fa48("562") ? !deletedPaths.length && !addedPaths.length : stryMutAct_9fa48("561") ? false : stryMutAct_9fa48("560") ? true : (stryCov_9fa48("560", "561", "562"), (stryMutAct_9fa48("563") ? deletedPaths.length : (stryCov_9fa48("563"), !deletedPaths.length)) || (stryMutAct_9fa48("564") ? addedPaths.length : (stryCov_9fa48("564"), !addedPaths.length)))) return stryMutAct_9fa48("565") ? ["Stryker was here"] : (stryCov_9fa48("565"), []);
    const entities = await loadEntitiesById(cwd);
    const deletedByHash = new Map<string, {
      entityId: string;
      from: string;
    }>();
    for (const from of deletedPaths) {
      if (stryMutAct_9fa48("566")) {
        {}
      } else {
        stryCov_9fa48("566");
        const entityId = Object.keys(entities).find(stryMutAct_9fa48("567") ? () => undefined : (stryCov_9fa48("567"), id => stryMutAct_9fa48("570") ? entities[id]?.currentPath !== from : stryMutAct_9fa48("569") ? false : stryMutAct_9fa48("568") ? true : (stryCov_9fa48("568", "569", "570"), (stryMutAct_9fa48("571") ? entities[id].currentPath : (stryCov_9fa48("571"), entities[id]?.currentPath)) === from)));
        if (stryMutAct_9fa48("574") ? false : stryMutAct_9fa48("573") ? true : stryMutAct_9fa48("572") ? entityId : (stryCov_9fa48("572", "573", "574"), !entityId)) continue;
        const hash = stryMutAct_9fa48("575") ? entities[entityId].contentHash : (stryCov_9fa48("575"), entities[entityId]?.contentHash);
        if (stryMutAct_9fa48("578") ? false : stryMutAct_9fa48("577") ? true : stryMutAct_9fa48("576") ? hash : (stryCov_9fa48("576", "577", "578"), !hash)) continue;
        deletedByHash.set(hash, stryMutAct_9fa48("580") ? {} : (stryCov_9fa48("580"), {
          entityId,
          from
        }));
      }
    }
    const moves: MoveCandidate[] = stryMutAct_9fa48("581") ? ["Stryker was here"] : (stryCov_9fa48("581"), []);
    for (const to of addedPaths) {
      if (stryMutAct_9fa48("582")) {
        {}
      } else {
        stryCov_9fa48("582");
        const absPath = path.join(cwd, to);
        const hash = await byteHashFile(absPath).catch(stryMutAct_9fa48("583") ? () => undefined : (stryCov_9fa48("583"), () => null));
        if (stryMutAct_9fa48("586") ? false : stryMutAct_9fa48("585") ? true : stryMutAct_9fa48("584") ? hash : (stryCov_9fa48("584", "585", "586"), !hash)) continue;
        const match = deletedByHash.get(hash);
        if (stryMutAct_9fa48("589") ? false : stryMutAct_9fa48("588") ? true : stryMutAct_9fa48("587") ? match : (stryCov_9fa48("587", "588", "589"), !match)) continue;
        moves.push(stryMutAct_9fa48("591") ? {} : (stryCov_9fa48("591"), {
          entityId: match.entityId,
          from: match.from,
          to,
          confidence: 1,
          method: stryMutAct_9fa48("592") ? "" : (stryCov_9fa48("592"), "same-hash")
        }));
      }
    }
    return moves;
  }
}