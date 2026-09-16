/*
<MODULE_CONTRACT>
<purpose>Changelog module registering changelog generation commands.</purpose>
<non-goals>
  <item>Do not implement changelog logic here — delegate to site-kernel-changelog.</item>
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
  runChangelogGenerate,
  runChangelogRebuildIndex,
  runChangelogBackfill,
} from "./../runtime/changelog";

const changelogFlags = {
  provider: {
    kind: "string",
    description: "LLM provider override: openai or anthropic.",
  },
  model: {
    kind: "string",
    description: "LLM model override for changelog generation.",
  },
  mode: {
    kind: "string",
    description: "Release cadence mode: weekly or monthly.",
  },
  day: {
    kind: "string",
    description: "Release day number used by the changelog cadence check.",
  },
  tz: {
    kind: "string",
    description: "Timezone used by release-day calculations.",
  },
} as const;

export const changelogModule: ModuleExport = {
  name: "changelog",
  version: "0.1.0",
  declarations: [],
  commands: [
    {
      name: "changelog.generate",
      modulePath: "tools/modules/changelog.module.ts",
      description: "Generate the changelog.",
      scope: "app",
      mutatesState: true,
      supportsAllSites: true,
      cacheable: false,
      generates: [{ path: "CHANGELOG.md", phase: "build.prepare", conditional: true }],
      writes: [
        "<app>/CHANGELOG.md",
        "<app>/changelogs/**",
        "<app>/.changelog-system/state.json",
        "<app>/package.json",
        ".changelog-system/cache/**",
      ],
      reads: ["<app>/src/content/**", "<app>/package.json"],
      flags: { ...changelogFlags },
      execute: runChangelogGenerate,
    },
    {
      name: "changelog.rebuild-index",
      description: "Rebuild changelog index.",
      scope: "app",
      mutatesState: true,
      cacheable: false,
      writes: ["<app>/CHANGELOG.md"],
      reads: ["<app>/CHANGELOG.md", "<app>/changelogs/**"],
      flags: { ...changelogFlags },
      execute: runChangelogRebuildIndex,
    },
    {
      name: "changelog.backfill",
      description: "Backfill changelog history.",
      scope: "app",
      mutatesState: true,
      cacheable: false,
      writes: ["<app>/CHANGELOG.md", "<app>/changelogs/**", ".changelog-system/cache/**"],
      reads: ["<app>/src/content/**", "<app>/package.json"],
      flags: {
        ...changelogFlags,
        start: { kind: "string", required: true, description: "Backfill start date (YYYY-MM-DD)." },
        end: { kind: "string", required: true, description: "Backfill end date (YYYY-MM-DD)." },
      },
      execute: runChangelogBackfill,
    }
  ],
  pipelines: [],
};
