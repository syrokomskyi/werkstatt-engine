/*
<MODULE_CONTRACT>
<purpose>Service module registering icon, open-source, material credit generation, and metadata write commands.</purpose>
<non-goals>
  <item>Do not implement generation logic here — delegate to site-kernel-codegen.</item>
</non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>TODO: record current design decisions</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-0527: added content.ref-index.generate command.</item>
  <item>RFC-0528: updated material.metadata.write description, writes, and reads for manifest-based discovery.</item>
  <item>RFC-0529: added content.ref-migrate command.</item>
  <item>RFC-0570: added content.formula.migrate command.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into <history>, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <history>RFC-0226</history>
</CHANGE_SUMMARY>
*/
import type { ModuleExport } from "@warpgogol/werkstatt-engine/runtime/desired-state";
import {
  runCleanIcons,
  runGenerateIcons,
  runGenerateMaterialCreditsPage,
  runGenerateOpenSourcePage,
  runMaterialMetadataWrite,
  runContentRefIndexGenerate,
  runContentRefMigrate,
  runContentFormulaMigrate,
} from "@warpgogol/werkstatt-site/codegen";

export const serviceModule: ModuleExport = {
  name: "service",
  version: "0.1.0",
  declarations: [],
  commands: [
    {
      name: "icons.generate",
      modulePath: "tools/modules/service.module.ts",
      description: "Generate Astro icon wrappers from icon JSON assets.",
      scope: "app",
      mutatesState: true,
      cacheable: false,
      writes: ["<app>/src/components/icons/generated/**"],
      reads: ["<app>/src/content/system.md"],
      flags: {},
      generates: [{ path: "src/components/icons/generated/**", phase: "build.prepare", conditional: true }],
      execute: runGenerateIcons,
    },
    {
      name: "icons.clean",
      description: "Delete generated Astro icon wrappers.",
      scope: "app",
      mutatesState: true,
      cacheable: false,
      writes: ["<app>/src/components/icons/generated/**"],
      reads: ["<app>/src/components/icons/generated/**"],
      flags: {},
      execute: runCleanIcons,
    },
    {
      name: "open-source.generate",
      modulePath: "tools/modules/service.module.ts",
      description: "Generate the open-source disclosure page from production dependencies.",
      scope: "app",
      mutatesState: true,
      cacheable: false,
      writes: [
        "<app>/src/content/pages/{lang}/open-source.md",
        "<app>/.cache/open-source.fingerprint",
      ],
      reads: ["<app>/package.json"],
      generates: [
        { path: "src/content/pages/{lang}/open-source.md", phase: "build.prepare", conditional: true },
        { path: "public/open-source/THIRD_PARTY_NOTICES.txt", phase: "build.prepare", conditional: true },
        { path: "public/open-source/THIRD_PARTY_LICENSES.txt", phase: "build.prepare", conditional: true },
        { path: "public/open-source/sbom.cdx.json", phase: "build.prepare", conditional: true },
      ],
      flags: {
        "show-versions": {
          kind: "boolean",
          description: "Include dependency versions in the generated disclosure prose.",
        },
      },
      execute: runGenerateOpenSourcePage,
    },
    {
      name: "material.credits.generate",
      modulePath: "tools/modules/service.module.ts",
      description: "Generate localized material credits pages from *.credits.yaml sidecars.",
      scope: "app",
      mutatesState: true,
      cacheable: false,
      writes: [
        "<app>/src/content/pages/{lang}/credits.md",
        "<app>/src/content/prose/{lang}/credits.md",
      ],
      reads: ["<app>/src/content/**/*.credits.yaml", "<app>/public/**/*.credits.yaml"],
      generates: [
        { path: "src/content/pages/{lang}/credits.md", phase: "build.post" },
        { path: "src/content/prose/{lang}/credits.md", phase: "build.post" },
      ],
      flags: {},
      execute: runGenerateMaterialCreditsPage,
    },
    {
      name: "material.metadata.write",
      description:
        "Write IPTC/XMP metadata (title, copyright, creator, artist, comment, WebStatement, encoder) into derived image/video variants from manifests. Uses MaterialCredit sidecars with content reference resolution and SemanticSiteProfile fallback. Gracefully skips when exiftool is unavailable (RFC-0528).",
      scope: "app",
      mutatesState: true,
      cacheable: false,
      writes: ["<app>/public/_img/**/*.webp", "<app>/public/_video/**"],
      reads: [
        "<app>/src/content/**/*.credits.yaml",
        "<app>/src/video-manifest.generated.yaml",
        "<app>/src/live-video-manifest.generated.yaml",
        "<app>/src/image-variants.generated.yaml",
        "<app>/src/content-ref-index.generated.yaml",
        "<app>/src/content/system.md",
      ],
      flags: {},
      execute: runMaterialMetadataWrite,
    },
    {
      name: "content.ref-index.generate",
      modulePath: "tools/modules/service.module.ts",
      description:
        "Scan src/content/ for .md files, parse frontmatter, and write src/content-ref-index.generated.yaml (RFC-0527).",
      scope: "app",
      mutatesState: true,
      cacheable: false,
      writes: ["<app>/src/content-ref-index.generated.yaml"],
      reads: ["<app>/src/content/**/*.md"],
      flags: {},
      generates: [{ path: "src/content-ref-index.generated.yaml", phase: "build.prepare" }],
      execute: runContentRefIndexGenerate,
    },
    {
      name: "content.ref-migrate",
      description:
        "Migrate brace-delimited {collection.file.field} references to braceless syntax in src/content/ (RFC-0529). Idempotent.",
      scope: "app",
      mutatesState: true,
      cacheable: false,
      writes: ["<app>/src/content/**/*.md", "<app>/src/content/**/*.yaml"],
      reads: ["<app>/src/content/**/*.md", "<app>/src/content/**/*.yaml"],
      flags: {},
      execute: runContentRefMigrate,
    },
    {
      name: "content.formula.migrate",
      description:
        "Convert hardcoded arithmetic patterns next to content references to =(...) formula syntax in src/content/ (RFC-0570). Manual command — not in any pipeline. Idempotent.",
      scope: "app",
      mutatesState: true,
      cacheable: false,
      writes: ["<app>/src/content/**/*.md"],
      reads: ["<app>/src/content/**/*.md"],
      flags: {},
      execute: runContentFormulaMigrate,
    }
  ],
  pipelines: [],
};
