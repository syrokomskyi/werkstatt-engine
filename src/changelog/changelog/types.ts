/*
<MODULE_CONTRACT>
<purpose>Defines schemas and types for commit and release management within the changelog system.</purpose>
<non-goals>
  <item>Do not implement business logic for commit processing or release generation.</item>
  <item>Do not handle raw content parsing or external data fetching.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

import { z } from "zod";

// START_BLOCK_SCHEMAS
export const RawCommitSchema = z.object({
  hash: z.string(),
  treeHash: z.string(),
  author: z.string(),
  date: z.coerce.date(),
  message: z.string(),
  body: z.string().optional(),
  files: z.array(z.string()),
  diffSummary: z.string(),
  isConventional: z.boolean(),
  conventionalType: z.string().optional(),
});

export const ClassifiedCommitSchema = z.object({
  hash: z.string(),
  type: z.enum([
    "feat",
    "fix",
    "refactor",
    "perf",
    "docs",
    "style",
    "chore",
    "test",
    "build",
    "ci",
    "breaking",
    "skip",
  ]),
  severity: z.enum(["minor", "patch", "none"]),
  module: z.string(),
  summary: z.string(),
  isConventional: z.boolean(),
  isBreaking: z.boolean(),
  confidence: z.number().min(0).max(1),
});

export const GroupedReleaseSchema = z.object({
  date: z.string(),
  groups: z.array(
    z.object({
      module: z.string(),
      type: z.string(),
      items: z.array(
        z.object({
          summary: z.string(),
          hashes: z.array(z.string()),
        }),
      ),
    }),
  ),
});

export type RawCommit = z.infer<typeof RawCommitSchema>;
export type ClassifiedCommit = z.infer<typeof ClassifiedCommitSchema>;
export type GroupedRelease = z.infer<typeof GroupedReleaseSchema>;
// END_BLOCK_SCHEMAS

// START_BLOCK_INTERFACES
export interface SystemState {
  lastProcessedCommitHash: string;
  lastVersion: string;
  processedWindows: Array<{
    from: string;
    to: string;
    version: string;
    checksum: string;
  }>;
}

export interface BumpResult {
  version: string;
  hasBreakingChanges: boolean;
  requiresReview: boolean;
}
// END_BLOCK_INTERFACES
