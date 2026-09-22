/*
<MODULE_CONTRACT>
  <purpose>platform-module — platform kernel module registering the platform.consistency.validate command (RFC-0478).</purpose>
  <non-goals>
    <item>Do not register sternsystem, mission, or handoff commands — those have their own modules.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0478: initial platform module for platform.consistency.validate.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

import type { ModuleExport } from "@warpgogol/werkstatt-shared/kernel";
import { runPlatformUpdate } from "./platform-update.ts";

export async function createPlatformModule(): Promise<ModuleExport> {
  const { runPlatformConsistencyValidate } = await import("./platform-consistency.ts");
  return {
    name: "platform",
    version: "0.1.0",
    declarations: [],
    commands: [
      {
        name: "platform.consistency.validate",
        contract: "platform",
        rules: [],
        modulePath: "packages/werkstatt-engine/src/handoff/platform-module.ts",
        generates: [],
        description:
          "Validate that platformSemanticHash drift is accompanied by a version bump, and that versionBump RFCs correspond to actual version changes (RFC-0478).",
        scope: "workspace",
        supportsAllSites: false,
        flags: {
          json: { kind: "boolean", description: "JSON output for agent consumption." },
          check: {
            kind: "boolean",
            description: "Read-only mode: validate without writing the log file (for CI).",
          },
        },
        reads: [
          "package.json",
          "packages/**",
          "docs/rfcs/**/*.md",
          "docs/platform-version-log.generated.yaml",
        ],
        writes: ["docs/platform-version-log.generated.yaml"],
        cacheable: false,
        execute: runPlatformConsistencyValidate,
        gate: {
          severity: "error",
          phase: "workspace",
          rules: ["PC-01", "PC-02", "PC-03"],
          blocks: ["release.prepare"],
        },
      },
      {
        name: "werkstatt.platform.update",
        contract: "platform",
        rules: [],
        modulePath: "packages/werkstatt-engine/src/handoff/platform-module.ts",
        generates: [],
        description:
          "Bump @warpgogol/* platform dependencies in a workshop and report Sternsystems whose pinnedPlatform drifts from the new installed version (RFC-1125). Idempotent — re-running on an up-to-date workshop is a no-op.",
        scope: "workspace",
        supportsAllSites: false,
        flags: {
          to: {
            kind: "string",
            description: "Target version: semver (e.g. 6.317.0) or 'latest' (default).",
          },
          json: { kind: "boolean", description: "JSON output for agent consumption." },
        },
        reads: [
          "package.json",
          "node_modules/@warpgogol/**",
          "../systems-cache/*/system-config.yaml",
        ],
        writes: ["package.json", "pnpm-lock.yaml"],
        mutatesState: true,
        cacheable: false,
        execute: runPlatformUpdate,
      },
    ],
    pipelines: [],
  };
}
