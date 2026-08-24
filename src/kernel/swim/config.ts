/*
<MODULE_CONTRACT>
<purpose>
RFC-0564: Config loading, validation, and creation for werkstatt.swim.json.
The config file is workshop-local (gitignored) and created by swim.join on
first call. It stores the workshop UUID v7, bind address, seed nodes, and
SWIM protocol timing parameters.
</purpose>
<non-goals>
  <item>Do not implement SWIM protocol logic — that is delegated to the swim npm package.</item>
  <item>Do not implement genome log I/O — that lives in genome-log.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0564: initial implementation — config loading, validation, and creation.</item>
</CHANGE_SUMMARY>
*/

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { v7 as uuidv7 } from "uuid";
import type { SwimConfig } from "./types.ts";

const CONFIG_FILENAME = "werkstatt.swim.json";

const DEFAULT_BIND_ADDR = "0.0.0.0:7946";
const DEFAULT_PROBE_INTERVAL_MS = 5000;
const DEFAULT_PROBE_TIMEOUT_MS = 500;
const DEFAULT_SUSPICION_TIMEOUT_MS = 15000;
const DEFAULT_INDIRECT_CHECKS = 3;

export function validateConfig(config: unknown): asserts config is SwimConfig {
  if (typeof config !== "object" || config === null) {
    throw new Error("swim config must be an object");
  }
  const c = config as Record<string, unknown>;

  if (typeof c.workshopId !== "string" || c.workshopId.length === 0) {
    throw new Error("swim config: workshopId must be a non-empty string");
  }
  if (typeof c.bindAddr !== "string" || c.bindAddr.length === 0) {
    throw new Error("swim config: bindAddr must be a non-empty string");
  }
  if (!Array.isArray(c.seedNodes)) {
    throw new Error("swim config: seedNodes must be an array");
  }
  for (const seed of c.seedNodes) {
    if (typeof seed !== "string" || seed.length === 0) {
      throw new Error("swim config: each seedNode must be a non-empty string");
    }
  }
  if (typeof c.probeIntervalMs !== "number" || c.probeIntervalMs <= 0) {
    throw new Error("swim config: probeIntervalMs must be a positive number");
  }
  if (typeof c.probeTimeoutMs !== "number" || c.probeTimeoutMs <= 0) {
    throw new Error("swim config: probeTimeoutMs must be a positive number");
  }
  if (typeof c.suspicionTimeoutMs !== "number" || c.suspicionTimeoutMs <= 0) {
    throw new Error("swim config: suspicionTimeoutMs must be a positive number");
  }
  if (typeof c.indirectChecks !== "number" || c.indirectChecks < 0) {
    throw new Error("swim config: indirectChecks must be a non-negative number");
  }
}

export async function loadSwimConfig(workspaceRoot: string): Promise<SwimConfig> {
  const configPath = join(workspaceRoot, CONFIG_FILENAME);
  const raw = await readFile(configPath, "utf8");
  const parsed: unknown = JSON.parse(raw);
  validateConfig(parsed);
  return parsed;
}

export async function createSwimConfig(workspaceRoot: string, seed: string): Promise<SwimConfig> {
  const config: SwimConfig = {
    workshopId: uuidv7(),
    bindAddr: DEFAULT_BIND_ADDR,
    seedNodes: [seed],
    probeIntervalMs: DEFAULT_PROBE_INTERVAL_MS,
    probeTimeoutMs: DEFAULT_PROBE_TIMEOUT_MS,
    suspicionTimeoutMs: DEFAULT_SUSPICION_TIMEOUT_MS,
    indirectChecks: DEFAULT_INDIRECT_CHECKS,
  };

  const configPath = join(workspaceRoot, CONFIG_FILENAME);
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");

  return config;
}

export async function loadOrCreateSwimConfig(
  workspaceRoot: string,
  seed?: string,
): Promise<SwimConfig> {
  try {
    return await loadSwimConfig(workspaceRoot);
  } catch {
    if (!seed) {
      throw new Error("swim config: no werkstatt.swim.json found and no --seed provided");
    }
    return await createSwimConfig(workspaceRoot, seed);
  }
}

export async function validateSwimConfig(workspaceRoot: string): Promise<boolean> {
  try {
    await loadSwimConfig(workspaceRoot);
    return true;
  } catch {
    return false;
  }
}

export { CONFIG_FILENAME };
