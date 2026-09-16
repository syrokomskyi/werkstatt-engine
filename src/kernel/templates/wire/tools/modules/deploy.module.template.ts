/*
<MODULE_CONTRACT>
<purpose>Deploy module registering client export command.</purpose>
<non-goals>
  <item>Do not implement export logic here — delegate to site-kernel-deploy.</item>
</non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>TODO: record current design decisions</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/
import type { ModuleExport } from "@warpgogol/werkstatt-engine/runtime/desired-state";
import { runClientExport } from "./../runtime/client-export";

export const deployModule: ModuleExport = {
  name: "deploy",
  version: "0.1.0",
  declarations: [],
  commands: [
    {
      name: "client.export",
      description: "Export the current app for client delivery.",
      scope: "app",
      mutatesState: true,
      cacheable: false,
      writes: ["../clients/<app>/**"],
      reads: ["<app>/dist/**"],
      flags: {},
      execute: runClientExport,
    }
  ],
  pipelines: [],
};
