/*
<MODULE_CONTRACT>
<purpose>
RFC-1037: Registers effect.classify, effect.compensation.verify, and
effect.compensation.inspect kernel commands for external-effect compensation
verification.
</purpose>
<non-goals>
  <item>Does not implement classification logic — that lives in effect-classifier.ts.</item>
  <item>Does not implement probe execution — that lives in compensation-verifier.ts.</item>
  <item>Does not register non-effect commands.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1037: initial implementation — registers 3 effect.* commands.</item>
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
