/*
<MODULE_CONTRACT>
  <purpose>TypeScript contracts for RFC-0566 immutable platform deploy with atomic rollback.</purpose>


  <non-goals>
    <item>Do not implement command logic — this file is types only.</item>
    <item>Do not define Leitstand types — those live in the leitstand module.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0566: initial deploy type contracts.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

export interface PlatformArtifact {
  hash: string;
  gitSha: string;
  builtAt: string;
  buildHost: string;
  manifest: ArtifactManifest;
}

export interface ArtifactManifest {
  hash: string;
  files: ArtifactFile[];
  totalSize: number;
  builtAt: string;
  gitSha: string;
  buildHost: string;
  signature: string;
  signatureAlgorithm: "Ed25519";
}

export interface ArtifactFile {
  path: string;
  hash: string;
  size: number;
}

export interface DeployStatus {
  currentHash: string | null;
  previousHash: string | null;
  currentGitSha: string | null;
  deployedAt: string | null;
  workshops: WorkshopDeployStatus[];
}

export interface WorkshopDeployStatus {
  workshopId: string;
  endpoint: string;
  currentHash: string;
  status: "prepared" | "committed" | "rolled-back" | "failed";
  lastDeployAt: string;
}

export interface AtomicSwapResult {
  swapped: boolean;
  previousHash: string | null;
  newHash: string;
  swapTimeMs: number;
}

export interface TwoPhaseCommitResult {
  phase: "prepare" | "commit" | "abort";
  workshops: WorkshopDeployStatus[];
  committed: boolean;
  rolledBack: boolean;
}

export interface ArtifactGcResult {
  dryRun: boolean;
  examined: number;
  deleted: number;
  retained: number;
  candidates: Array<{ hash: string; reason: string }>;
}

export interface ArtifactVerifyResult {
  verified: boolean;
  hash: string;
  expectedHash: string;
  signatureVerified: boolean;
}

export interface ArtifactBuildResult {
  hash: string;
  gitSha: string;
  builtAt: string;
  buildHost: string;
  fileCount: number;
  totalSize: number;
  artifactPath: string;
}
