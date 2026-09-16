/*
<MODULE_CONTRACT>
<purpose>resolution-proof — component resolution violation codes and proof type definitions.</purpose>
<non-goals>
  <item>Do not resolve components — this module defines the proof contract.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

import type { ComponentId, CapabilityId } from "../component/contracts.ts";
import type { ResolvedComponentSetV1 } from "../component/contracts.ts";

export type ResolutionViolationCode =
  | "RESOLUTION-01"
  | "RESOLUTION-02"
  | "RESOLUTION-03"
  | "RESOLUTION-04"
  | "RESOLUTION-05"
  | "RESOLUTION-06"
  | "RESOLUTION-07"
  | "RESOLUTION-08";

export interface ResolutionViolationV1 {
  readonly code: ResolutionViolationCode;
  readonly componentId: ComponentId | null;
  readonly capability: CapabilityId | null;
  readonly message: string;
  readonly cyclePath?: readonly ComponentId[];
}

export interface ResolutionProofV1 {
  readonly schema: "werkstatt/resolution-proof@1";
  readonly profileId: string;
  readonly setHash: string;
  readonly componentCount: number;
  readonly edgeCount: number;
  readonly maxDepth: number;
  readonly resolvedAt: string;
}

export function createResolutionProof(
  profileId: string,
  set: ResolvedComponentSetV1,
  edgeCount: number,
  maxDepth: number,
): ResolutionProofV1 {
  return {
    schema: "werkstatt/resolution-proof@1",
    profileId,
    setHash: set.setHash,
    componentCount: set.components.length,
    edgeCount,
    maxDepth,
    resolvedAt: new Date().toISOString(),
  };
}
