/*
<MODULE_CONTRACT>
<purpose>
RFC-0565: Config loading, validation, and creation for werkstatt.dht.json.
The config file is workshop-local (gitignored) and created by dht.node.init.
It stores the DHT bind address, bootstrap nodes, replication factor, and
timeout parameters.
</purpose>
<non-goals>
  <item>Do not implement DHT routing logic — that lives in node.ts.</item>
  <item>Do not implement command handlers — those live in init.ts, lookup.ts, etc.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0565: initial implementation — config loading, validation, and creation.</item>
</CHANGE_SUMMARY>
*/

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dhtConfigSchema, type DHTConfig } from "./types.ts";

const CONFIG_FILENAME = "werkstatt.dht.json";

const DEFAULT_BIND_ADDR = "0.0.0.0:7947";
const DEFAULT_REPLICATION_FACTOR = 5;
const DEFAULT_LOOKUP_TIMEOUT_MS = 5000;
const DEFAULT_CACHE_TTL_MS = 300000;

export function validateDhtConfig(config: unknown): DHTConfig {
  return dhtConfigSchema.parse(config);
}

export async function loadDhtConfig(workspaceRoot: string): Promise<DHTConfig> {
  const configPath = join(workspaceRoot, CONFIG_FILENAME);
  const raw = await readFile(configPath, "utf8");
  const parsed: unknown = JSON.parse(raw);
  return validateDhtConfig(parsed);
}

export async function createDhtConfig(
  workspaceRoot: string,
  options: { bind?: string; bootstrap?: string[] },
): Promise<DHTConfig> {
  const config: DHTConfig = {
    bindAddr: options.bind ?? DEFAULT_BIND_ADDR,
    bootstrapNodes: options.bootstrap ?? [],
    replicationFactor: DEFAULT_REPLICATION_FACTOR,
    lookupTimeoutMs: DEFAULT_LOOKUP_TIMEOUT_MS,
    cacheTtlMs: DEFAULT_CACHE_TTL_MS,
  };

  const validated = validateDhtConfig(config);
  const configPath = join(workspaceRoot, CONFIG_FILENAME);
  await writeFile(configPath, JSON.stringify(validated, null, 2) + "\n", "utf8");

  return validated;
}

export async function loadOrCreateDhtConfig(
  workspaceRoot: string,
  options?: { bind?: string; bootstrap?: string[] },
): Promise<DHTConfig> {
  try {
    return await loadDhtConfig(workspaceRoot);
  } catch {
    if (!options) {
      throw new Error(`dht config: no ${CONFIG_FILENAME} found and no options provided`);
    }
    return await createDhtConfig(workspaceRoot, options);
  }
}

export { CONFIG_FILENAME };
