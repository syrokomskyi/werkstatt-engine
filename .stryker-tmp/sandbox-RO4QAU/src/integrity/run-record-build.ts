/******************************************************************************* 
<MODULE_CONTRACT> 
<purpose>Facilitates the recording of build artifacts and generation of provenance metadata.</purpose> 
 
 
<non-goals> 
  <item>Do not handle raw content parsing of build files.</item> 
  <item>Do not manage transport or configuration orchestration.</item> 
</non-goals> 
</MODULE_CONTRACT> 
 
<CHANGE_SUMMARY>
  <item>Tidied by compass.changesummary.tidy; see git history for prior entries.</item>
</CHANGE_SUMMARY> 
*******************************************************************************/
// @ts-nocheck


/**
 * Record build artifacts and create provenance metadata.
 * Collects hashes of dist files and stores build metadata for signing.
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
import { collectBuildOutputs, createBuildProvenance, writeBuildArtifacts } from "./build.ts";
export async function runRecordBuild(args: {
  cwd: string;
  builder?: string;
  distDir?: string;
}): Promise<void> {
  if (stryMutAct_9fa48("811")) {
    {}
  } else {
    stryCov_9fa48("811");
    const outputs = await collectBuildOutputs(args.cwd, args.distDir);
    const provenance = await createBuildProvenance(stryMutAct_9fa48("812") ? {} : (stryCov_9fa48("812"), {
      cwd: args.cwd,
      builder: stryMutAct_9fa48("813") ? args.builder && "local" : (stryCov_9fa48("813"), args.builder ?? (stryMutAct_9fa48("814") ? "" : (stryCov_9fa48("814"), "local"))),
      outputs
    }));
    await writeBuildArtifacts(stryMutAct_9fa48("815") ? {} : (stryCov_9fa48("815"), {
      cwd: args.cwd,
      outputs,
      provenance
    }));
    console.log(stryMutAct_9fa48("817") ? "Stryker was here!" : (stryCov_9fa48("817"), ""));
    console.log(stryMutAct_9fa48("819") ? "" : (stryCov_9fa48("819"), "Integrity build record"));
    console.log(stryMutAct_9fa48("821") ? `` : (stryCov_9fa48("821"), `  build id ${outputs.buildId}`));
    console.log(stryMutAct_9fa48("823") ? `` : (stryCov_9fa48("823"), `  outputs  ${Object.keys(outputs.outputs).length}`));
    console.log(stryMutAct_9fa48("825") ? `` : (stryCov_9fa48("825"), `  builder  ${provenance.builder}`));
  }
}