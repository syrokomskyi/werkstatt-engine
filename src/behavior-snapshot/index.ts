/*
<MODULE_CONTRACT>
<purpose>RFC-0357: behavior snapshot command module — registers behavior.snapshot.capture and behavior.snapshot.diff.</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0357: initial behavior snapshot module.</item>
</CHANGE_SUMMARY>
*/

import type { KernelModule } from "@warpgogol/werkstatt-engine/kernel";
import {
  runBehaviorSnapshotCapture,
  runBehaviorSnapshotDiff,
} from "./behavior-snapshot-commands.ts";

export {
  runBehaviorSnapshotCapture,
  type BehaviorSnapshotCaptureData,
  runBehaviorSnapshotDiff,
  type BehaviorSnapshotDiffData,
} from "./behavior-snapshot-commands.ts";

export function createBehaviorSnapshotModule(): KernelModule {
  return {
    name: "behavior-snapshot",
    version: "0.1.0",
    register(registry) {
      registry.registerCommand({
        name: "behavior.snapshot.capture",
        description:
          "Capture a behavior snapshot from a build output directory (RFC-0357). Flags: --dist, --system, --build-kind, [--release].",
        scope: "workspace",
        supportsAllSites: false,
        flags: {
          dist: { kind: "string", required: true, description: "Build output directory." },
          system: { kind: "string", required: true, description: "Sternsystem id." },
          "build-kind": {
            kind: "string",
            required: true,
            description: "Build kind: readable or production.",
          },
          release: { kind: "string", description: "Related release id." },
        },
        execute: runBehaviorSnapshotCapture,
      });
      registry.registerCommand({
        name: "behavior.snapshot.diff",
        description:
          "Compare two behavior snapshots and report structural differences (RFC-0357). Flags: --baseline, --candidate.",
        scope: "workspace",
        supportsAllSites: false,
        flags: {
          baseline: { kind: "string", required: true, description: "Baseline snapshot path." },
          candidate: { kind: "string", required: true, description: "Candidate snapshot path." },
        },
        execute: runBehaviorSnapshotDiff,
      });
    },
  };
}
