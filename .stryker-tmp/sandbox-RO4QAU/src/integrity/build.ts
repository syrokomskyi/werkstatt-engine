/***************************************************************
 * <MODULE_CONTRACT>
 * <purpose>Facilitates the collection of build outputs and the creation of build provenance metadata.</purpose>
 *  *  * <non-goals>
 * <item>Do not handle raw file parsing or content validation.</item>
 * <item>Do not manage build orchestration or execution flow.</item>
 * <item>Do not interact with external systems beyond file I/O.</item>
 * </non-goals>
 * </MODULE_CONTRACT>
 *  * <CHANGE_SUMMARY>
  <item>Migrated hash imports from deleted ./hash.ts wrapper to @warpgogol/fingerprint directly.</item>
</CHANGE_SUMMARY>
 ***************************************************************/
// @ts-nocheck


/**
 * Build artifact collection and provenance creation.
 * Computes hashes of dist files and creates signed build metadata.
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
import { byteHash, byteHashFile } from "@warpgogol/werkstatt-engine/fingerprint";
import { discoverManagedFiles } from "./discover.ts";
import { discoverDistFiles } from "./internal-dist.ts";
import { getHeadSha, getRepoUrl } from "./git.ts";
import { writeJsonFile } from "./json.ts";
import { outputsPath, provenancePath } from "./paths.ts";
import type { BuildProvenance, OutputsFile } from "./types.ts";
export async function collectBuildOutputs(cwd: string, distDir = stryMutAct_9fa48("0") ? "" : (stryCov_9fa48("0"), "dist")): Promise<OutputsFile> {
  if (stryMutAct_9fa48("1")) {
    {}
  } else {
    stryCov_9fa48("1");
    const buildId = new Date().toISOString().replace(stryMutAct_9fa48("2") ? /[^:.]/g : (stryCov_9fa48("2"), /[:.]/g), stryMutAct_9fa48("3") ? "" : (stryCov_9fa48("3"), "-"));
    const outputs: Record<string, string> = {};
    const files = await discoverDistFiles(cwd, distDir);
    for (const file of files) {
      if (stryMutAct_9fa48("4")) {
        {}
      } else {
        stryCov_9fa48("4");
        outputs[file] = await byteHashFile(path.join(cwd, file));
      }
    }
    return stryMutAct_9fa48("5") ? {} : (stryCov_9fa48("5"), {
      buildId,
      outputs
    });
  }
}
export async function buildInputsDigest(cwd: string): Promise<string> {
  if (stryMutAct_9fa48("6")) {
    {}
  } else {
    stryCov_9fa48("6");
    const files = await discoverManagedFiles(cwd);
    const entries = await Promise.all(files.map(stryMutAct_9fa48("7") ? () => undefined : (stryCov_9fa48("7"), async file => stryMutAct_9fa48("8") ? `` : (stryCov_9fa48("8"), `${file}\t${await byteHashFile(path.join(cwd, file))}`))));
    const combined = entries.join(stryMutAct_9fa48("9") ? "" : (stryCov_9fa48("9"), "\n"));
    return byteHash(combined);
  }
}
export async function createBuildProvenance(args: {
  cwd: string;
  builder: string;
  outputs: OutputsFile;
}): Promise<BuildProvenance> {
  if (stryMutAct_9fa48("10")) {
    {}
  } else {
    stryCov_9fa48("10");
    const started = new Date().toISOString();
    const outputsDigest = byteHash(JSON.stringify(args.outputs.outputs));
    const inputsDigest = await buildInputsDigest(args.cwd);
    const finished = new Date().toISOString();
    return stryMutAct_9fa48("11") ? {} : (stryCov_9fa48("11"), {
      buildId: args.outputs.buildId,
      sourceRepo: stryMutAct_9fa48("12") ? (await getRepoUrl(args.cwd)) && "unknown" : (stryCov_9fa48("12"), (await getRepoUrl(args.cwd)) ?? (stryMutAct_9fa48("13") ? "" : (stryCov_9fa48("13"), "unknown"))),
      sourceCommit: stryMutAct_9fa48("14") ? (await getHeadSha(args.cwd)) && "unknown" : (stryCov_9fa48("14"), (await getHeadSha(args.cwd)) ?? (stryMutAct_9fa48("15") ? "" : (stryCov_9fa48("15"), "unknown"))),
      builder: args.builder,
      buildStartedAt: started,
      buildFinishedAt: finished,
      inputsDigest,
      outputsDigest
    });
  }
}
export async function writeBuildArtifacts(args: {
  cwd: string;
  outputs: OutputsFile;
  provenance: BuildProvenance;
}): Promise<void> {
  if (stryMutAct_9fa48("16")) {
    {}
  } else {
    stryCov_9fa48("16");
    await writeJsonFile(outputsPath(args.cwd), args.outputs);
    await writeJsonFile(provenancePath(args.cwd), args.provenance);
  }
}