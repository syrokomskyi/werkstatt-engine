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

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into <history>, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
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
