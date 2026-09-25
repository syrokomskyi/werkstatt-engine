/*
<MODULE_CONTRACT>
<purpose>test-helpers — shared test helpers for sternsystem.validate unit tests (RFC-0574, RFC-0792).</purpose>

<non-goals>
  <item>Do not use in production — these helpers exist for sternsystem.validate unit tests only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0792: extracted shared test helpers from mirror-validate.test.ts.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

import { join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";
import { createDefaultIO, type WorkspaceIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";

export function makeInput(flags: Record<string, unknown>): KernelCommandInput {
  return {
    flags: flags as Record<string, import("@warpgogol/werkstatt-engine/kernel").KernelFlagValue>,
    argv: [],
  };
}

export function makeContext(root: string): KernelRuntimeContext {
  return {
    io: createDefaultIO().io,
    workspaceRoot: root,
    logger: {
      section: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      success: () => {},
    },
    dryRun: false,
  } as unknown as KernelRuntimeContext;
}

export interface MirrorEntry {
  path: string;
  storageType: "non-bare" | "bare" | "bundle";
}

export async function writeSystemConfig(root: string, mirrors: MirrorEntry[], io: WorkspaceIO = createDefaultIO().io): Promise<void> {
  const cacheDir = join(root, "..", "systems-cache", "test-bundle");
  await io.mkdir(cacheDir);
  const config = {
    schemaVersion: "system-config/v1",
    id: "test-bundle",
    cosmicStar: "Vega",
    mirrors,
    pinnedPlatform: "4.5.0",
    status: "active",
    registeredAt: "2026-01-01T00:00:00Z",
    notes: "",
  };
  await io.writeFile(join(cacheDir, "system-config.yaml"), stringifyYaml(config) + "\n");

  const pin = {
    schemaVersion: "system-pin/v1",
    systemId: "test-bundle",
    cosmicStar: "Vega",
    pinnedAt: "2026-01-01T00:00:00Z",
    platform: {
      version: "4.5.0",
      commit: "abcdef0",
      rfcHead: "RFC-0001",
      platformSemanticHash:
        "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    },
    migratorCursor: [],
    capabilities: [],
  };
  const pinJson = JSON.stringify(pin, null, 2) + "\n";
  await io.writeFile(join(cacheDir, "system.pin.json"), pinJson);

  // Also write pin to the cache dir resolved from mirrors[0].path (may differ)
  const mirrorCacheDir = join(root, mirrors[0].path.replace(/^\.\//, ""));
  if (mirrorCacheDir !== cacheDir) {
    await io.mkdir(mirrorCacheDir);
    await io.writeFile(join(mirrorCacheDir, "system.pin.json"), pinJson);
  }
}

export const BASE_SETUP = async (root: string, io: WorkspaceIO = createDefaultIO().io) => {
  await io.mkdir(join(root, "docs", "rfcs"));
  await io.writeFile(join(root, "docs", "rfcs", "RFC-0001-test.md"), "");
  await io.writeFile(join(root, "package.json"), JSON.stringify({ version: "4.5.0" }));
  await io.writeFile(join(root, "uni.registry.yaml"), JSON.stringify({ entries: [{ id: "test", semanticId: "test", version: "1.0.0", intent: [] }] }));
  await io.mkdir(join(root, "packages", "dummy"));
  await io.writeFile(join(root, "packages", "dummy", "index.ts"), "export const x = 1;\n");
};
