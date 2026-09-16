/*
<MODULE_CONTRACT>
<purpose>
RFC-0565: Command handler for dht.node.init. Creates werkstatt.dht.json with
bind address, bootstrap nodes, replication factor, and timeout parameters.
The config file is workshop-local (gitignored).
</purpose>
<non-goals>
  <item>Do not start a DHT node — that lives in node.ts.</item>
  <item>Do not implement other DHT command handlers — those live in their own files.</item>
</non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>Init writes a fresh config only — it never overwrites an existing werkstatt.dht.json.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-0565: initial implementation — dht.node.init command handler.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

import type { KernelCommandInput, KernelCommandResult, KernelRuntimeContext } from "../types.ts";
import type { DHTConfig } from "./types.ts";
import { createDhtConfig, loadDhtConfig, CONFIG_FILENAME } from "./config.ts";

interface DhtNodeInitResult {
  created: boolean;
  config: DHTConfig | null;
  diagnostics?: string[];
}

export async function runDhtNodeInit(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<DhtNodeInitResult>> {
  const { workspaceRoot } = context;
  const bind = input.flags["bind"] as string | undefined;
  const bootstrapFlag = input.flags["bootstrap"] as string | string[] | undefined;

  const bootstrap = Array.isArray(bootstrapFlag)
    ? bootstrapFlag
    : bootstrapFlag
      ? [bootstrapFlag]
      : [];

  try {
    const existing = await loadDhtConfig(workspaceRoot);
    return {
      data: {
        created: false,
        config: existing,
        diagnostics: [
          `dht.node.init: ${CONFIG_FILENAME} already exists — use --force to overwrite`,
        ],
      },
      exitCode: 0,
      summary: `[dht.node.init] config already exists at ${CONFIG_FILENAME}`,
    };
  } catch {
    // Config doesn't exist — create it
  }

  const config = await createDhtConfig(workspaceRoot, { bind, bootstrap });

  return {
    data: {
      created: true,
      config,
    },
    exitCode: 0,
    summary: `[dht.node.init] created ${CONFIG_FILENAME} with bindAddr ${config.bindAddr}`,
  };
}
