/*
<MODULE_CONTRACT>
<purpose>RFC-1031: Health monitor — tracks consecutive health check failures
  and triggers quarantine after a configurable threshold (default: 3).</purpose>
<non-goals>
  <item>Does not perform health checks — receives results from callers.</item>
  <item>Does not quarantine candidates — returns a boolean, caller acts on it.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1031: initial implementation — consecutive failure tracking with configurable threshold.</item>
</CHANGE_SUMMARY>
*/

import type { HealthCheckResultV1 } from "./contracts.ts";

export interface HealthMonitor {
  recordResult(candidateId: string, result: HealthCheckResultV1): void;
  shouldQuarantine(candidateId: string): boolean;
  getConsecutiveFailures(candidateId: string): number;
  reset(candidateId: string): void;
}

export function createHealthMonitor(
  quarantineThreshold: number = 3,
): HealthMonitor {
  const consecutiveFailures = new Map<string, number>();

  return {
    recordResult(candidateId: string, result: HealthCheckResultV1): void {
      const current = consecutiveFailures.get(candidateId) ?? 0;
      if (result.status === "unhealthy") {
        consecutiveFailures.set(candidateId, current + 1);
      } else {
        consecutiveFailures.set(candidateId, 0);
      }
    },

    shouldQuarantine(candidateId: string): boolean {
      const failures = consecutiveFailures.get(candidateId) ?? 0;
      return failures >= quarantineThreshold;
    },

    getConsecutiveFailures(candidateId: string): number {
      return consecutiveFailures.get(candidateId) ?? 0;
    },

    reset(candidateId: string): void {
      consecutiveFailures.delete(candidateId);
    },
  };
}
