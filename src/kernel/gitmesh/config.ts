/*
<MODULE_CONTRACT>
<purpose>
RFC-0563: Config loading, validation, and auto-creation for werkstatt.gitmesh.json.
In Phase 1, auto-creates config from existing .git/config remotes if the file
does not exist. In Phase 2+, the config is created by werkstatt.network.bootstrap
(RFC-0562) and edited by the operator.
</purpose>
<non-goals>
  <item>Do not implement git operations — those live in git-ops.ts.</item>
  <item>Do not implement command handlers — those live in sync.ts, status.ts, verify.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0563: initial implementation — config loading, validation, and auto-creation.</item>
</CHANGE_SUMMARY>
*/

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gitRemoteList } from "./git-ops.ts";
import type { GitMeshConfig, GitMeshRemote } from "./types.ts";

const CONFIG_FILENAME = "werkstatt.gitmesh.json";

const DEFAULT_CONFIG: Omit<GitMeshConfig, "remotes"> = {
  trackedBranch: "main",
  syncIntervalMs: 0,
  verifySignatures: false,
};

export function validateConfig(config: unknown): asserts config is GitMeshConfig {
  if (typeof config !== "object" || config === null) {
    throw new Error("gitmesh config must be an object");
  }
  const c = config as Record<string, unknown>;

  if (!Array.isArray(c.remotes)) {
    throw new Error("gitmesh config: remotes must be an array");
  }
  for (const remote of c.remotes) {
    if (typeof remote !== "object" || remote === null) {
      throw new Error("gitmesh config: each remote must be an object");
    }
    const r = remote as Record<string, unknown>;
    if (typeof r.name !== "string" || r.name.length === 0) {
      throw new Error("gitmesh config: remote.name must be a non-empty string");
    }
    if (typeof r.url !== "string" || r.url.length === 0) {
      throw new Error("gitmesh config: remote.url must be a non-empty string");
    }
    if (typeof r.trusted !== "boolean") {
      throw new Error("gitmesh config: remote.trusted must be a boolean");
    }
  }

  if (typeof c.trackedBranch !== "string" || c.trackedBranch.length === 0) {
    throw new Error("gitmesh config: trackedBranch must be a non-empty string");
  }
  if (typeof c.syncIntervalMs !== "number" || c.syncIntervalMs < 0) {
    throw new Error("gitmesh config: syncIntervalMs must be a non-negative number");
  }
  if (typeof c.verifySignatures !== "boolean") {
    throw new Error("gitmesh config: verifySignatures must be a boolean");
  }
}

export async function loadGitMeshConfig(workspaceRoot: string): Promise<GitMeshConfig> {
  const configPath = join(workspaceRoot, CONFIG_FILENAME);
  const raw = await readFile(configPath, "utf8");
  const parsed: unknown = JSON.parse(raw);
  validateConfig(parsed);
  return parsed;
}

export async function autoCreateConfigFromGit(workspaceRoot: string): Promise<GitMeshConfig> {
  const remotes = await gitRemoteList(workspaceRoot);
  const gitMeshRemotes: GitMeshRemote[] = remotes.map((r: { name: string; url: string }) => ({
    name: r.name,
    url: r.url,
    trusted: true,
  }));

  const config: GitMeshConfig = {
    ...DEFAULT_CONFIG,
    remotes: gitMeshRemotes,
  };

  const configPath = join(workspaceRoot, CONFIG_FILENAME);
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");

  return config;
}

export async function loadOrCreateConfig(workspaceRoot: string): Promise<GitMeshConfig> {
  try {
    return await loadGitMeshConfig(workspaceRoot);
  } catch {
    return await autoCreateConfigFromGit(workspaceRoot);
  }
}

export { CONFIG_FILENAME };
