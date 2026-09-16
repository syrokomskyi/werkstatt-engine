/*
<MODULE_CONTRACT>
<purpose>Integrity module registering integrity tracking and signing commands.</purpose>
<non-goals>
  <item>Do not implement integrity logic here — delegate to site-kernel-integrity.</item>
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
import {
  runIntegrityBackfillRevisions,
  runIntegrityBuildRecord,
  runIntegrityGenerateSigningKeypair,
  runIntegrityInit,
  runIntegritySign,
  runIntegrityUpdate,
  runIntegrityVerify,
  runIntegrityVerifyRelease,
} from "./../runtime/integrity";

export const integrityModule: ModuleExport = {
  name: "integrity",
  version: "0.1.0",
  declarations: [],
  commands: [
    {
      name: "integrity.init",
      description: "Initialize integrity tracking.",
      scope: "app",
      mutatesState: true,
      cacheable: false,
      writes: ["<app>/.integrity/**"],
      reads: ["<app>/.integrity/**"],
      flags: {},
      execute: runIntegrityInit,
    },
    {
      name: "integrity.update",
      description: "Update integrity manifests.",
      scope: "app",
      mutatesState: true,
      cacheable: false,
      writes: ["<app>/.integrity/**"],
      reads: ["<app>/.integrity/**"],
      flags: {},
      execute: runIntegrityUpdate,
    },
    { name: "integrity.verify", description: "Verify integrity manifests.", scope: "app", flags: {}, reads: ["<app>/.integrity/**"], execute: runIntegrityVerify },
    {
      name: "integrity.build-record",
      description: "Record build outputs.",
      scope: "app",
      mutatesState: true,
      cacheable: false,
      writes: ["<app>/.integrity/build/latest/**"],
      reads: ["<app>/dist/**"],
      flags: {},
      execute: runIntegrityBuildRecord,
    },
    {
      name: "integrity.sign",
      description: "Sign integrity artifacts.",
      scope: "app",
      mutatesState: true,
      cacheable: false,
      writes: ["<app>/.integrity/build/latest/**"],
      reads: ["<app>/.integrity/**"],
      flags: {},
      execute: runIntegritySign,
    },
    { name: "integrity.verify-release", description: "Verify release signatures.", scope: "app", requiresNetwork: true, flags: {}, reads: ["<app>/.integrity/**"], cacheable: false, execute: runIntegrityVerifyRelease },
    {
      name: "integrity.keys.generate",
      modulePath: "tools/modules/integrity.module.ts",
      description: "Generate integrity signing keys.",
      scope: "app",
      mutatesState: true,
      cacheable: false,
      writes: ["<app>/.integrity/keys/**", "<app>/public/studio.public.pem"],
      generates: [
        { path: ".integrity/keys/private.pem", phase: "build.prepare", conditional: true },
        { path: "public/studio.public.pem", phase: "build.prepare", conditional: true },
      ],
      flags: {},
      execute: runIntegrityGenerateSigningKeypair,
    },
    {
      name: "integrity.backfill-revisions",
      description: "Backfill integrity revision counters.",
      scope: "app",
      mutatesState: true,
      cacheable: false,
      writes: ["<app>/.integrity/**"],
      reads: ["<app>/.integrity/**"],
      flags: {},
      execute: runIntegrityBackfillRevisions,
    }
  ],
  pipelines: [],
};
