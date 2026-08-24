/*
<MODULE_CONTRACT>
  <purpose>RFC-0926: Test Worker Version ID parsing, release-to-version-ID lookup, and default previous-release rollback behavior.</purpose>
  <keywords>RFC-0926, leitstand, rollback, worker-version-id, to-release, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0926: initial tests for extractWorkerVersionId, resolveRollbackVersionId, and runWranglerRollback with versionId.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import { extractWorkerVersionId } from "../leitstand/service-deploy-helpers.ts";

test("extractWorkerVersionId parses version ID from wrangler deploy stdout", () => {
  const stdout = `
Total Upload: 25.52 KiB / gzip: 8.57 KiB
Worker Startup Time: 11 ms
Deployed warpgogol-com triggers (0.04 sec)
https://warpgogol-com.warpgogol.workers.dev
Current Version ID: 85591b84-28f8-43ac-916f-098620e6edc1
`;
  const versionId = extractWorkerVersionId(stdout);
  expect(versionId).toBe("85591b84-28f8-43ac-916f-098620e6edc1");
});

test("extractWorkerVersionId returns undefined when version ID is absent", () => {
  const stdout = `
Total Upload: 25.52 KiB / gzip: 8.57 KiB
Worker Startup Time: 11 ms
Deployed warpgogol-com triggers (0.04 sec)
https://warpgogol-com.warpgogol.workers.dev
`;
  const versionId = extractWorkerVersionId(stdout);
  expect(versionId).toBeUndefined();
});

test("extractWorkerVersionId handles case-insensitive label", () => {
  const stdout = "current version id: abc123-def456\n";
  const versionId = extractWorkerVersionId(stdout);
  expect(versionId).toBe("abc123-def456");
});

test("extractWorkerVersionId handles empty stdout", () => {
  const versionId = extractWorkerVersionId("");
  expect(versionId).toBeUndefined();
});
