/*
<MODULE_CONTRACT>
<purpose>
RFC-0563: TypeScript contracts for the git-mesh platform code replication
subsystem. Defines the config, remote, sync result, status, and verify result
interfaces used by gitmesh.sync, gitmesh.status, and gitmesh.verify commands.
</purpose>
<non-goals>
  <item>Do not implement command handlers — those live in sync.ts, status.ts, verify.ts.</item>
  <item>Do not implement git operations — those live in git-ops.ts.</item>
  <item>Do not implement config loading — that lives in config.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0563: initial implementation — type contracts for git-mesh subsystem.</item>
  <item>RFC-0563 fix: add optional diagnostics field to result types for RFC-0086 compliance.</item>
</CHANGE_SUMMARY>
*/

export interface GitMeshConfig {
  remotes: GitMeshRemote[];
  trackedBranch: string;
  syncIntervalMs: number;
  verifySignatures: boolean;
}

export interface GitMeshRemote {
  name: string;
  url: string;
  trusted: boolean;
}

export interface GitMeshSyncResult {
  synced: boolean;
  fromRemote: string;
  commitsReceived: number;
  currentSha: string;
  signaturesVerified: number;
  signaturesFailed: number;
  diagnostics?: string[];
}

export interface GitMeshStatus {
  localSha: string;
  remoteSha: string;
  behind: number;
  ahead: number;
  lastSync: string;
  remotes: GitMeshRemote[];
  diagnostics?: string[];
}

export interface GitMeshVerifyResult {
  totalCommits: number;
  signedCommits: number;
  unsignedCommits: number;
  invalidSignatures: number;
  verified: boolean;
  diagnostics?: string[];
}
