/*
<MODULE_CONTRACT>
  <purpose>TypeScript contracts for RFC-0566 immutable platform deploy with atomic rollback.</purpose>
  <keywords>deploy, artifact, atomic, rollback, symlink, platform</keywords>
  <responsibilities>
    <item>Define types for platform artifacts, manifests, deploy status, and atomic swap results.</item>
    <item>Define Phase 4 two-phase commit types (stubs — not exercised in pilot).</item>
  </responsibilities>
  <non-goals>
    <item>Do not implement command logic — this file is types only.</item>
    <item>Do not define Leitstand types — those live in the leitstand module.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0566: initial deploy type contracts.</item>
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
