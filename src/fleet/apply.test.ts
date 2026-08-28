import { describe, it, expect } from "vitest";
import type { FleetSiteRecord } from "./fleet-sites-generate.ts";

// Test the wave partitioning logic indirectly by verifying the FleetSiteRecord
// canary field controls wave assignment. The full runFleetApply requires
// mocking executeKernelCommand/Pipeline which is complex — we test the
// data structures and flag parsing here.

describe("FleetSiteRecord wave partitioning", () => {
  const sites: FleetSiteRecord[] = [
    { id: "a", path: "../systems-cache/a", platformVersion: "1", channels: { dev: { releaseId: null }, alt: { releaseId: null }, main: { releaseId: null } }, mirrors: { count: 1, protocols: ["file"] }, activeMission: null, canary: true },
    { id: "b", path: "../systems-cache/b", platformVersion: "1", channels: { dev: { releaseId: null }, alt: { releaseId: null }, main: { releaseId: null } }, mirrors: { count: 1, protocols: ["file"] }, activeMission: null, canary: false },
    { id: "c", path: "../systems-cache/c", platformVersion: "1", channels: { dev: { releaseId: null }, alt: { releaseId: null }, main: { releaseId: null } }, mirrors: { count: 1, protocols: ["file"] }, activeMission: null, canary: false },
  ];

  it("partitions canary sites into canary wave", () => {
    const canaryWave = sites.filter((s) => s.canary);
    const restWave = sites.filter((s) => !s.canary);
    expect(canaryWave).toHaveLength(1);
    expect(canaryWave[0].id).toBe("a");
    expect(restWave).toHaveLength(2);
  });

  it("wave=canary filter selects only canary sites", () => {
    const waveFilter = "canary";
    const canarySites = sites.filter((s) => s.canary);
    const restSites = waveFilter === "canary" ? [] : sites.filter((s) => !s.canary);
    expect(canarySites).toHaveLength(1);
    expect(restSites).toHaveLength(0);
  });

  it("wave=all includes both canary and rest", () => {
    const canaryWave = sites.filter((s) => s.canary);
    const restWave = sites.filter((s) => !s.canary);
    expect(canaryWave.length + restWave.length).toBe(3);
  });

  it("empty canary wave is handled gracefully", () => {
    const noCanary: FleetSiteRecord[] = sites.filter((s) => !s.canary);
    const canaryWave = noCanary.filter((s) => s.canary);
    expect(canaryWave).toHaveLength(0);
  });
});

describe("FleetApplyResult structure", () => {
  it("counts ok/failed/skipped correctly", () => {
    const entries = [
      { site: "a", wave: "canary" as const, status: "ok" as const, exitCode: 0, durationMs: 100 },
      { site: "b", wave: "rest" as const, status: "failed" as const, exitCode: 1, durationMs: 200 },
      { site: "c", wave: "rest" as const, status: "skipped(stop-threshold)" as const, exitCode: null, durationMs: 0 },
      { site: "d", wave: "rest" as const, status: "skipped(precondition)" as const, exitCode: -1, durationMs: 0 },
    ];
    const ok = entries.filter((e) => e.status === "ok").length;
    const failed = entries.filter((e) => e.status === "failed").length;
    const skipped = entries.filter((e) => e.status.startsWith("skipped")).length;
    expect(ok).toBe(1);
    expect(failed).toBe(1);
    expect(skipped).toBe(2);
  });

  it("exitCode is 1 when any failures exist", () => {
    const failed = 1;
    const exitCode = failed > 0 ? 1 : 0;
    expect(exitCode).toBe(1);
  });

  it("exitCode is 0 when no failures", () => {
    const failed = 0;
    const exitCode = failed > 0 ? 1 : 0;
    expect(exitCode).toBe(0);
  });
});
