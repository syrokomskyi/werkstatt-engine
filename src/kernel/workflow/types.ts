/*
<MODULE_CONTRACT>
<purpose>Defines the RFC-0075 workflow frontmatter contract and command result types.</purpose>
<non-goals>
  <item>Do not execute workflows or mutate onboarding artifacts.</item>
</non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>Contracts are type-only — the RFC-0075 frontmatter contract is data, not code.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-0075: Add workflow command type contracts.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

export const WORKFLOW_PHASES = [
  "prepare",
  "synthesize",
  "scaffold",
  "compose",
  "author",
  "audit",
  "handoff",
] as const;

export type WorkflowPhase = (typeof WORKFLOW_PHASES)[number];

export interface WorkflowScope {
  allowedWriteRoots: string[];
  forbiddenWriteRoots: string[];
}

export interface WorkflowRecoveryRule {
  on: string;
  do: string;
}

export interface WorkflowSelfOrchestration {
  autoRun: boolean;
  pauseFor: string[];
}

export interface WorkflowFrontmatter {
  id: string;
  title: string;
  phase: WorkflowPhase;
  reads: string[];
  writes: string[];
  scope: WorkflowScope;
  runs: string[];
  recoveryRules: WorkflowRecoveryRule[];
  agentInvariants: string[];
  selfOrchestration: WorkflowSelfOrchestration;
  checkpoints: string[];
  nextWorkflow?: string;
}

export interface WorkflowListEntry {
  id: string;
  title: string;
  phase: WorkflowPhase;
  file: string;
  reads: string[];
  writes: string[];
  runs: string[];
  nextWorkflow?: string;
}

export interface WorkflowLintViolation {
  file: string;
  code: string;
  message: string;
}

export interface WorkflowLintResult {
  command: "workflow.lint";
  workflowDirectory: string;
  filesChecked: number;
  violations: WorkflowLintViolation[];
}
