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
<CHANGE_SUMMARY>
  <item>RFC-0564: initial implementation — type contracts for SWIM membership subsystem.</item>
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
