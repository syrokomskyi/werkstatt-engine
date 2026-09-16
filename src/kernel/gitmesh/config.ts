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
<KEY_DECISIONS>
  <item>Config auto-creates with defaults when absent — gitmesh is usable without manual setup.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-0563: initial implementation — config loading, validation, and auto-creation.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
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
