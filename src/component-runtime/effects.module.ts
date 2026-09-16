/*
<MODULE_CONTRACT>
<purpose>effects.module — registers the effect.classify, effect.compensation.verify, and effect.compensation.execute kernel commands with the registry (RFC-1037).</purpose>
<non-goals>
  <item>Does not implement classification logic — that lives in effect-classifier.ts.</item>
  <item>Does not implement probe execution — that lives in compensation-verifier.ts.</item>
  <item>Does not register non-effect commands.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1037: initial implementation — registers 3 effect.* commands.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

import type { ModuleExport } from "../runtime/desired-state.ts";

export async function createEffectsModule(): Promise<ModuleExport> {
  const { runEffectClassify, runEffectCompensationVerify, runEffectCompensationInspect } =
    await import("./effect-commands.ts");

  const modulePath = "packages/werkstatt-engine/src/component-runtime/effects.module.ts";

  return {
    name: "effects",
    version: "0.1.0",
    declarations: [],
    commands: [
      {
        name: "effect.classify",
        modulePath,
        description:
          "RFC-1037: Classify an operation into one of four effect classes (revertible, " +
          "transactional, compensatable, irreversible-emission) before execution. " +
          "Returns { operation, effectClass } as JSON.",
        execute: runEffectClassify,
        scope: "workspace",
        mutatesState: false,
        cacheable: false,
        requiresNetwork: false,
        reads: ["effect-registry"],
        writes: [],
        generates: [],
      },
      {
        name: "effect.compensation.verify",
        modulePath,
        description:
          "RFC-1037: Verify that a compensating action restored the system to an equivalent " +
          "state. Runs all verification probes in parallel, stores the result in the " +
          "compensation evidence store (SQLite), and returns CompensationResult as JSON. " +
          "Exit code 0 if verified, 1 if verification failed.",
        execute: runEffectCompensationVerify,
        scope: "workspace",
        mutatesState: true,
        cacheable: false,
        requiresNetwork: true,
        reads: ["effect-registry", "compensation-evidence"],
        writes: ["compensation-evidence", "file-system"],
        generates: [],
      },
      {
        name: "effect.compensation.inspect",
        modulePath,
        description:
          "RFC-1037: Inspect stored compensation evidence for a given operation hash. " +
          "Returns CompensationResult or null if no evidence exists.",
        execute: runEffectCompensationInspect,
        scope: "workspace",
        mutatesState: false,
        cacheable: false,
        requiresNetwork: false,
        reads: ["compensation-evidence"],
        writes: [],
        generates: [],
      },
    ],
    pipelines: [],
  };
}
