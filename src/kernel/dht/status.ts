/*
<MODULE_CONTRACT>
<purpose>
RFC-0565: dht.status command handler. Reports local DHT node status including
config, cache entries, and peer connectivity. Local-only query — no network
I/O except for checking if the DHT node is reachable.
</purpose>
<non-goals>
  <item>Do not start a DHT node — status is read from config and cache files only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0565: initial implementation — dht.status handler.</item>
</CHANGE_SUMMARY>
*/

import { join } from "node:path";
import { readFile } from "node:fs/promises";
import type { KernelCommandInput, KernelCommandResult, KernelRuntimeContext } from "../types.ts";
import { loadDhtConfig } from "./config.ts";
import { loadCache } from "./cache.ts";

const IDENTITY_FILENAME = "werkstatt.identity.json";
const SWIM_FILENAME = "werkstatt.swim.json";

interface DhtStatusResult {
  initialized: boolean;
  configPath: string | null;
  bindAddr: string | null;
  bootstrapNodes: string[];
  replicationFactor: number | null;
  cacheEntries: number;
  cachePath: string;
  identityBootstrapped: boolean;
  swimConfigured: boolean;
  diagnostics?: string[];
}

export async function runDhtStatus(
  _input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<DhtStatusResult>> {
  const { workspaceRoot } = context;

  // Check DHT config
  let config = null;
  let configPath: string | null = null;
  try {
    config = await loadDhtConfig(workspaceRoot);
    configPath = join(workspaceRoot, "werkstatt.dht.json");
  } catch {
    // Not initialized
  }

  // Check identity
  let identityBootstrapped = false;
  try {
    await readFile(join(workspaceRoot, IDENTITY_FILENAME), "utf8");
    identityBootstrapped = true;
  } catch {
    // Not bootstrapped
  }

  // Check SWIM
  let swimConfigured = false;
  try {
    await readFile(join(workspaceRoot, SWIM_FILENAME), "utf8");
    swimConfigured = true;
  } catch {
    // Not configured
  }

  // Load cache
  const cache = await loadCache(workspaceRoot);
  const cachePath = join(workspaceRoot, "werkstatt.dht.cache.json");
  const cacheEntries = Object.keys(cache.entries).length;

  if (!config) {
    return {
      data: {
        initialized: false,
        configPath: null,
        bindAddr: null,
        bootstrapNodes: [],
        replicationFactor: null,
        cacheEntries,
        cachePath,
        identityBootstrapped,
        swimConfigured,
        diagnostics: [
          `dht.status: DHT not initialized — run dht.node.init first`,
          ...(!identityBootstrapped
            ? [`dht.status: identity not bootstrapped — run identity.bootstrap first (RFC-0558)`]
            : []),
        ],
      },
      exitCode: 0,
      summary: `[dht.status] not initialized`,
    };
  }

  return {
    data: {
      initialized: true,
      configPath,
      bindAddr: config.bindAddr,
      bootstrapNodes: config.bootstrapNodes,
      replicationFactor: config.replicationFactor,
      cacheEntries,
      cachePath,
      identityBootstrapped,
      swimConfigured,
    },
    exitCode: 0,
    summary: `[dht.status] initialized, bind=${config.bindAddr}, bootstrap=${config.bootstrapNodes.length} nodes, cache=${cacheEntries} entries`,
  };
}
