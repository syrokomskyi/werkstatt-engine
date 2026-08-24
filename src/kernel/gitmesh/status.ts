/*
<MODULE_CONTRACT>
<purpose>
RFC-0563: gitmesh.status command handler. A local-only query that reports
the current sync state (local SHA, remote SHA, behind/ahead counts, last sync
time) without performing any network I/O. Safe to run frequently.
</purpose>
<non-goals>
  <item>Do not perform network I/O — this is a local-only query based on remote-tracking branches.</item>
  <item>Do not fetch from remotes — use gitmesh.sync for that.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0563: initial implementation — gitmesh.status local-only query handler.</item>
  <item>RFC-0563 fix: add diagnostics array on error return (RFC-0086).</item>
</CHANGE_SUMMARY>
*/

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { KernelCommandInput, KernelCommandResult, KernelRuntimeContext } from "../types.ts";
import type { GitMeshStatus } from "./types.ts";
import { loadGitMeshConfig } from "./config.ts";
import {
  gitCommitTimestamp,
  gitRevListCount,
  gitRevParseHead,
  gitRevParseRemote,
} from "./git-ops.ts";

const LAST_SYNC_FILE = ".git/gitmesh.last-sync";

export async function runGitMeshStatus(
  _input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<GitMeshStatus>> {
  const { workspaceRoot } = context;

  let config;
  try {
    config = await loadGitMeshConfig(workspaceRoot);
  } catch {
    return {
      data: {
        localSha: "",
        remoteSha: "",
        behind: 0,
        ahead: 0,
        lastSync: "",
        remotes: [],
        diagnostics: ["gitmesh.status: no werkstatt.gitmesh.json found — run gitmesh.sync first"],
      },
      exitCode: 1,
      summary: "[gitmesh.status] no werkstatt.gitmesh.json found — run gitmesh.sync first",
      nextSteps: [
        {
          action: "Run gitmesh.sync first to configure gitmesh, then re-run gitmesh.status",
          kind: "required",
        },
      ],
    };
  }

  const localSha = await gitRevParseHead(workspaceRoot).catch(() => "");

  // Find the latest remote-tracking branch by committer timestamp
  let remoteSha = "";
  let latestTimestamp = 0;

  for (const remote of config.remotes) {
    try {
      const sha = await gitRevParseRemote(remote.name, config.trackedBranch, workspaceRoot);
      const timestamp = await gitCommitTimestamp(sha, workspaceRoot);
      if (timestamp > latestTimestamp) {
        latestTimestamp = timestamp;
        remoteSha = sha;
      }
    } catch {
      // remote-tracking branch doesn't exist — skip
    }
  }

  let behind = 0;
  let ahead = 0;

  if (remoteSha && localSha) {
    behind = await gitRevListCount(localSha, remoteSha, workspaceRoot).catch(() => 0);
    ahead = await gitRevListCount(remoteSha, localSha, workspaceRoot).catch(() => 0);
  }

  // Read last sync time
  let lastSync = "";
  try {
    lastSync = await readFile(join(workspaceRoot, LAST_SYNC_FILE), "utf8");
    lastSync = lastSync.trim();
  } catch {
    // No last sync file — never synced
  }

  return {
    data: {
      localSha,
      remoteSha,
      behind,
      ahead,
      lastSync,
      remotes: config.remotes,
    },
    exitCode: 0,
    summary:
      `[gitmesh.status] ${behind} behind, ${ahead} ahead` +
      (lastSync ? `, last sync: ${lastSync}` : ", never synced"),
  };
}
