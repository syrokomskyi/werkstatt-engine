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
