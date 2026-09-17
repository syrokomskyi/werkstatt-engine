/*
<MODULE_CONTRACT>
<purpose>Maintains packages/os/site-kernel/src/command-manifest.module.ts as an authored site-kernel authored module so agents can evolve it without rediscovering local boundaries.</purpose>
<non-goals>
  <item>Does not register command.manifest.validate — that command lives in @warpgogol/site-kernel-checks so it can cross-check toOwnershipEntries(context.ownershipMap ?? []) (CMD-MAN-03) without a reverse package dependency.</item>
</non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>Module registers the command only — manifest generation lives in command-manifest.ts.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-0266: initial implementation.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

import type { ModuleExport } from "@warpgogol/werkstatt-shared/kernel";

export async function createCommandManifestModule(): Promise<ModuleExport> {
const { runCommandManifestGenerate } = await import("./command-manifest.ts");
  return {
  name: "command-manifest",
  version: "0.1.0",

    declarations: [],
  commands: [
    {
      name: "command.manifest.generate",
      modulePath: "packages/werkstatt-engine/src/kernel/command-manifest.module.ts",
      description:
        "Aggregate every registered command's metadata (flags, IO globs, mutability, timeouts, pipeline " +
        "membership) into docs/command-manifest.generated.yaml — the single machine-readable command " +
        "description. Use --dry-run to preview without writing (RFC-0266).",
      scope: "workspace",
      mutatesState: true,
      writes: ["docs/command-manifest.generated.yaml"],
      generates: [{ path: "docs/command-manifest.generated.yaml", phase: "build.prepare" }],
      cacheable: false,
      flags: {
        "dry-run": {
          kind: "boolean",
          description: "Preview the manifest without writing the file.",
        },
      },
      execute: runCommandManifestGenerate,
    }
  ],
  pipelines: [

  ]};
}
;
