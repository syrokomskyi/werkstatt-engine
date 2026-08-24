/*
<MODULE_CONTRACT>
<purpose>Shared test helpers for sternsystem.validate unit tests (RFC-0574, RFC-0792).</purpose>
<keywords>test-helpers, sternsystem, validate, mirror, yaml</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0792: extracted shared test helpers from mirror-validate.test.ts.</item>
</CHANGE_SUMMARY>
*/

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";

export function makeInput(flags: Record<string, unknown>): KernelCommandInput {
  return {
    flags: flags as Record<string, import("@warpgogol/werkstatt-engine/kernel").KernelFlagValue>,
    argv: [],
  };
}

export function makeContext(root: string): KernelRuntimeContext {
  return {
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

export async function writeSystemConfig(root: string, mirrors: MirrorEntry[]): Promise<void> {
  const cacheDir = join(root, "..", "systems-cache", "test-bundle");
  await mkdir(cacheDir, { recursive: true });
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
  await writeFile(join(cacheDir, "system-config.yaml"), stringifyYaml(config) + "\n", "utf8");

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
  await writeFile(join(cacheDir, "system.pin.json"), pinJson, "utf8");

  // Also write pin to the cache dir resolved from mirrors[0].path (may differ)
  const mirrorCacheDir = join(root, mirrors[0].path.replace(/^\.\//, ""));
  if (mirrorCacheDir !== cacheDir) {
    await mkdir(mirrorCacheDir, { recursive: true });
    await writeFile(join(mirrorCacheDir, "system.pin.json"), pinJson, "utf8");
  }
}

export const BASE_SETUP = async (root: string) => {
  await mkdir(join(root, "docs", "rfcs"), { recursive: true });
  await writeFile(join(root, "docs", "rfcs", "RFC-0001-test.md"), "", "utf8");
  await writeFile(join(root, "package.json"), JSON.stringify({ version: "4.5.0" }), "utf8");
  await writeFile(
    join(root, "uni.registry.yaml"),
    JSON.stringify({ entries: [{ id: "test", semanticId: "test", version: "1.0.0", intent: [] }] }),
    "utf8",
  );
  await mkdir(join(root, "packages", "dummy"), { recursive: true });
  await writeFile(join(root, "packages", "dummy", "index.ts"), "export const x = 1;\n", "utf8");
};
