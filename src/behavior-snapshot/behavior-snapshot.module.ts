/*
<MODULE_CONTRACT>
  <purpose>Lazy-loading kernel module for RFC-0357 behavior snapshot commands: capture and diff, comparing structural output between builds.</purpose>
  <non-goals>
    <item>Do not re-export types or utilities — the barrel behavior-snapshot/index.ts remains the public API surface.</item>
    <item>Do not register release or artifact-store commands here.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Lazy loading refactor: extracted from behavior-snapshot/index.ts to use dynamic imports inside async register().</item>
</CHANGE_SUMMARY>
*/

import type { KernelModule } from "@warpgogol/werkstatt-engine/kernel";

export function createBehaviorSnapshotModule(): KernelModule {
  return {
    name: "behavior-snapshot",
    version: "0.1.0",
    async register(registry) {
      const { runBehaviorSnapshotCapture, runBehaviorSnapshotDiff } =
        await import("./behavior-snapshot-commands.ts");
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
        reads: ["missions/*/distribution/**", "releases/*/distribution/**"],
        cacheable: false,
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
        reads: [
          "releases/*/evidence/behavior-snapshot*.json",
          "missions/*/evidence/behavior-snapshot*.json",
        ],
        execute: runBehaviorSnapshotDiff,
      });
    },
  };
}
