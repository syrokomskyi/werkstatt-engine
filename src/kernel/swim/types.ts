/*
<MODULE_CONTRACT>
<purpose>
RFC-0564: TypeScript contracts for the SWIM membership and CRDT genome
subsystem. Defines the member, config, membership view, and genome log entry
interfaces used by swim.join, swim.leave, swim.members, and swim.status commands.
</purpose>
<non-goals>
  <item>Do not implement command handlers — those live in handlers.ts.</item>
  <item>Do not implement genome log I/O — that lives in genome-log.ts.</item>
  <item>Do not implement config loading — that lives in config.ts.</item>
  <item>Do not implement SWIM protocol gossip — that is delegated to the swim npm package.</item>
</non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>Contracts are type-only — runtime behavior lives in the sibling modules.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-0564: initial implementation — type contracts for SWIM membership subsystem.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

export interface SwimMember {
  workshopId: string;
  endpoint: string;
  operatorVC: string;
  status: SwimMemberStatus;
  joinedAt: string;
  lastSeen: string;
}

export type SwimMemberStatus = "alive" | "suspect" | "dead" | "left";

export interface SwimConfig {
  workshopId: string;
  bindAddr: string;
  seedNodes: string[];
  probeIntervalMs: number;
  probeTimeoutMs: number;
  suspicionTimeoutMs: number;
  indirectChecks: number;
}

export interface SwimMembershipView {
  members: SwimMember[];
  total: number;
  alive: number;
  suspect: number;
  dead: number;
}

export interface GenomeLogEntry {
  workshopId: string;
  event: SwimMemberStatus;
  timestamp: string;
  source: string;
  signature: string;
}
