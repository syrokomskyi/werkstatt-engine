/*
<MODULE_CONTRACT>
<purpose>Defines a constant sequence for integrity operations in release processes.</purpose>
<non-goals>
  <item>Do not define the implementation details of each command.</item>
  <item>Do not manage the execution context or orchestration of the pipeline.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Clarify module purpose and responsibilities for future reference.</item>
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
import type { KernelPipelineStep } from "@warpgogol/werkstatt-engine/kernel";

// @ai-invariant STANDARD_INTEGRITY_PIPELINE is the single authoritative ordered sequence for
// integrity release operations. Apps spread this constant into their pipelines to get
// the full workflow: build record → sign → verify release.
export const STANDARD_INTEGRITY_PIPELINE: KernelPipelineStep[] = stryMutAct_9fa48("552") ? [] : (stryCov_9fa48("552"), [stryMutAct_9fa48("553") ? {} : (stryCov_9fa48("553"), {
  command: stryMutAct_9fa48("554") ? "" : (stryCov_9fa48("554"), "integrity.build-record")
}), stryMutAct_9fa48("555") ? {} : (stryCov_9fa48("555"), {
  command: stryMutAct_9fa48("556") ? "" : (stryCov_9fa48("556"), "integrity.sign")
}), stryMutAct_9fa48("557") ? {} : (stryCov_9fa48("557"), {
  command: stryMutAct_9fa48("558") ? "" : (stryCov_9fa48("558"), "integrity.verify-release")
})]);