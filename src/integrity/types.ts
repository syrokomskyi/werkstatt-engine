/*
<MODULE_CONTRACT>
<purpose>Defines TypeScript types for the integrity system, enabling structured representation of entities and their verification.</purpose>
<non-goals>
  <item>Do not implement logic for integrity verification or data processing.</item>
  <item>Do not manage file I/O or external data sources.</item>
  <item>Do not define application-level workflows or orchestration.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

/**
 * TypeScript type definitions for the integrity system.
 * Defines all entities, manifests, and verification types.
 */

export type IntegrityStatus = "active" | "deleted";

export interface IntegrityPolicy {
  $schemaVersion: 1;
  hashAlgorithm: "sha256";
  include: string[];
  exclude: string[];
  moveDetection: {
    enableHeuristics: boolean;
    similarityThreshold: number;
    maxDeletedCandidateAgeHours: number;
  };
  history: {
    keepDeletedLog: boolean;
    keepBuildHistory: boolean;
  };
}

export interface ManifestFileRecord {
  entityId: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  contentHash: string;
  gitSha: string;
  status: IntegrityStatus;
}

export interface DirectoryManifest {
  $schemaVersion: 1;
  directory: string;
  generatedAt: string;
  files: Record<string, ManifestFileRecord>;
}

export interface MoveRecord {
  from: string;
  to: string;
  detectedAt: string;
  confidence: number;
  method: "same-hash" | "heuristic";
}

export interface RegistryEntity {
  currentPath: string;
  firstPath?: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  contentHash: string;
  gitSha: string;
  status: IntegrityStatus;
  moves?: MoveRecord[];
}

export type EntitiesById = Record<string, RegistryEntity>;
export type PathsCurrent = Record<string, string>;

export interface DeletedLogItem {
  entityId: string;
  lastPath: string;
  deletedAt: string;
  lastRevision: number;
  lastHash: string;
}

export interface OutputsFile {
  buildId: string;
  outputs: Record<string, string>;
}

export interface BuildProvenance {
  buildId: string;
  sourceRepo: string;
  sourceCommit: string;
  builder: string;
  buildStartedAt: string;
  buildFinishedAt: string;
  inputsDigest: string;
  outputsDigest: string;
}

export interface SignablePayload {
  payloadVersion: "1";
  buildId: string;
  signedAt: string;
  outputsDigest: string;
  provenanceDigest: string;
}

export interface SignedManifest {
  buildId: string;
  signedAt: string;
  algorithm: "Ed25519";
  payloadVersion: "1";
  payload: SignablePayload;
  signatureHex: string;
  signatureBase64: string;
  publicKeyUrl?: string;
}

export interface GitFileHistory {
  createdAt: string | null;
  updatedAt: string | null;
  lastCommitSha: string | null;
}

export interface ChangedPaths {
  added: string[];
  modified: string[];
  deleted: string[];
  renamed: Array<{ from: string; to: string }>;
}

export interface MoveCandidate {
  entityId: string;
  from: string;
  to: string;
  confidence: number;
  method: "same-hash" | "heuristic";
}

export interface VerifyIssue {
  level: "error" | "warning";
  code: string;
  message: string;
  path?: string;
  entityId?: string;
}

export interface VerifyStats {
  managedFiles: number;
  managedDirectories: number;
  manifestsLoaded: number;
  activeEntities: number;
  activePathBindings: number;
  errors: number;
  warnings: number;
}

export interface VerifyReport {
  ok: boolean;
  issues: VerifyIssue[];
  stats: VerifyStats;
}
