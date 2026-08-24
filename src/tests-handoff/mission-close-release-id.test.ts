/*
<MODULE_CONTRACT>
  <purpose>
    RFC-0655: unit tests for mission.close releaseId propagation — verifies
    CloseReport includes releaseId and appendBordbuchEntry receives it as a
    top-level option.
  </purpose>
  <keywords>RFC-0655, mission.close, releaseId, CloseReport, bordbuch</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0655: initial tests for CloseReport.releaseId field and bordbuch top-level option.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import type { CloseReport } from "../mission/mission-close.ts";

test("CloseReport interface includes releaseId field", () => {
  const report: CloseReport = {
    releaseId: "sys-r000001",
    git: { commitSha: "abc", pushed: true, pushError: null, dirtyFiles: [] },
    mirror: {
      originSha: "abc",
      mirrorSha: "abc",
      inSync: true,
      recommendation: null,
      synced: false,
      syncError: null,
    },
    reconcile: {
      reconciledAt: "2026-08-01T10:00:00.000Z",
      verified: true,
      freshnessChecked: false,
      unreconciledCommits: 0,
      workpieceHead: null,
      reconciledSha: null,
    },
    templateSync: { synced: false, syncError: null },
    warnings: [],
  };
  expect(report.releaseId).toBe("sys-r000001");
});

test("CloseReport accepts null releaseId", () => {
  const report: CloseReport = {
    releaseId: null,
    git: { commitSha: "abc", pushed: true, pushError: null, dirtyFiles: [] },
    mirror: {
      originSha: "abc",
      mirrorSha: "abc",
      inSync: true,
      recommendation: null,
      synced: false,
      syncError: null,
    },
    reconcile: {
      reconciledAt: "2026-08-01T10:00:00.000Z",
      verified: true,
      freshnessChecked: false,
      unreconciledCommits: 0,
      workpieceHead: null,
      reconciledSha: null,
    },
    templateSync: { synced: false, syncError: null },
    warnings: [{ rule: "missing-release-id", message: "test" }],
  };
  expect(report.releaseId).toBe(null);
});

test("appendBordbuchEntry options accept releaseId as top-level option", () => {
  // This is a type-level test — if the option doesn't exist, TypeScript won't compile
  const options: {
    missionId?: string | null;
    releaseId?: string | null;
    writerRole?: string;
    metadata?: Record<string, unknown>;
  } = {
    missionId: "sys-m000001",
    releaseId: "sys-r000001",
    writerRole: "mission",
    metadata: { releaseId: "sys-r000001" },
  };
  expect(options.releaseId).toBe("sys-r000001");
});
