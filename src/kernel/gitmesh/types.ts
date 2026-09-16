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
<KEY_DECISIONS>
  <item>Contracts are type-only — runtime behavior lives in the sibling modules.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-0563: initial implementation — type contracts for git-mesh subsystem.</item>
  <item>RFC-0563 fix: add optional diagnostics field to result types for RFC-0086 compliance.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
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
