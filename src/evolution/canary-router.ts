/*
<MODULE_CONTRACT>
<purpose>RFC-1031: Canary traffic router — deterministic hash-based routing
  using Sha256Digest of canonical JSON input bytes (RFC-0849).</purpose>
<non-goals>
  <item>Does not execute components — only makes routing decisions.</item>
  <item>Does not monitor health — that is the health monitor's job.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1031: initial implementation — deterministic canary routing via Sha256Digest.</item>
</CHANGE_SUMMARY>
*/

import { byteHash } from "../fingerprint/primitives.ts";
import type { Sha256Digest } from "../fingerprint/primitives.ts";

const HASH_PREFIX_LENGTH = "sha256:".length;
const ROUTING_HASH_HEX_CHARS = 12;
const ROUTING_MODULUS = 100;

export interface CanaryRouter {
  routeToCandidate(input: unknown, trafficPercent: number): boolean;
  getRoutingHash(input: unknown): Sha256Digest;
}

export function createCanaryRouter(): CanaryRouter {
  return {
    routeToCandidate(input: unknown, trafficPercent: number): boolean {
      if (trafficPercent <= 0) return false;
      if (trafficPercent >= 100) return true;
      const hash = this.getRoutingHash(input);
      const hashNum = parseInt(
        hash.slice(HASH_PREFIX_LENGTH, HASH_PREFIX_LENGTH + ROUTING_HASH_HEX_CHARS),
        16,
      );
      return hashNum % ROUTING_MODULUS < trafficPercent;
    },

    getRoutingHash(input: unknown): Sha256Digest {
      const canonicalBytes = JSON.stringify(input);
      return byteHash(canonicalBytes) as Sha256Digest;
    },
  };
}
