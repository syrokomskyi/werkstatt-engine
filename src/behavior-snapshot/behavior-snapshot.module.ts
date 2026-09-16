/*
<MODULE_CONTRACT>
  <purpose>Lazy-loading kernel module for RFC-0357 behavior snapshot commands: capture and diff, comparing structural output between builds.</purpose>
  <non-goals>
    <item>Do not re-export types or utilities — the barrel behavior-snapshot/index.ts remains the public API surface.</item>
    <item>Do not register release or artifact-store commands here.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

import type { ModuleExport } from "../runtime/desired-state.ts";

export async function createBehaviorSnapshotModule(): Promise<ModuleExport> {
  const { runBehaviorSnapshotCapture, runBehaviorSnapshotDiff } =
        await import("./behavior-snapshot-commands.ts");
  return {
    name: "behavior-snapshot",
    version: "0.1.0",
      declarations: [],
  commands: [
    {
        name: "behavior.snapshot.capture",
        modulePath: "packages/werkstatt-engine/src/behavior-snapshot/behavior-snapshot.module.ts",
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
      },
    {
        name: "behavior.snapshot.diff",
        modulePath: "packages/werkstatt-engine/src/behavior-snapshot/behavior-snapshot.module.ts",
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
      }
  ],
  pipelines: [

  ]};
}
