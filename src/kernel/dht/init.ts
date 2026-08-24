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
<CHANGE_SUMMARY>
  <item>RFC-0565: initial implementation — dht.node.init command handler.</item>
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
