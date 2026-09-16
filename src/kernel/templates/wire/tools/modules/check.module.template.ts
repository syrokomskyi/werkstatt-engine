/*
<MODULE_CONTRACT>
<purpose>Check module registering lint, validation, and semantic mirror commands for the generated app kernel wiring.</purpose>
<non-goals>
  <item>Do not implement check logic here — delegate to site-kernel-checks.</item>
</non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>TODO: record current design decisions</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-0348: added compass.markup.migrate to extraCommands; updated header to v2 two-block contract.</item>
  <item>RFC-0374: compass.* commands migrated to @warpgogol/forge — see packages/forge/os/compass/</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into <history>, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
</CHANGE_SUMMARY>
*/
import type { ModuleExport } from "@warpgogol/werkstatt-engine/runtime/desired-state";
import {
  createStandardCheckModule,
  runSemanticMirrorValidate,
} from "@warpgogol/werkstatt-site/checks";
// compass.* handlers migrated to @warpgogol/forge — see packages/forge/os/compass/

export const checkModule: ModuleExport = createStandardCheckModule({
  defaultLang: "de",
  extraCommands: [
    {
      name: "semantic.mirror.validate",
      contract: "semantic",
      rules: [],
      description: "Validate semantic layer mirror integrity.",
      scope: "app",
      supportsAllSites: true,
      flags: {},
      reads: ["<app>/src/content/**/*.md", "packages/werkstatt/src/kernel/semantic/**"],
      execute: runSemanticMirrorValidate,
    },
  ],
});
