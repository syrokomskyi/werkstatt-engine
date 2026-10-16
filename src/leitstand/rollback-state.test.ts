/*
<MODULE_CONTRACT>
<purpose>RFC-1297: unit tests for recordSiteRollback — AC-1: lastPropagated
records the rolled-back release with state "rolled-back"; AC-2: the Bordbuch
carries one deployment-rolled-back event. Also pins gateForChannel.</purpose>
<keywords>RFC-1297, recordSiteRollback, deployment-rolled-back, gateForChannel</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1297: initial — AC-1/AC-2 probes.</item>
  <item>RFC-1297</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDefaultIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";
import { recordSiteRollback } from "./rollback-state.ts";
import { gateForChannel } from "./deploy-helpers.ts";
import { readSystemState } from "../sternsystem/registry-io.ts";
import { readBordbuch } from "../bordbuch/bordbuch-io.ts";

const systemId = "acme";
let tmpDir: string;
let werkstattRoot: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "rollback-state-"));
  werkstattRoot = join(tmpDir, "werkstatt");
  const cacheDir = join(tmpDir, "systems-cache", systemId);
  mkdirSync(werkstattRoot, { recursive: true });
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(
    join(cacheDir, "system-state.yaml"),
    [
      "schemaVersion: 1.0.0",
      `systemId: ${systemId}`,
      "currentMission: null",
      "lastRelease: acme-r000036",
      "lastPropagated:",
      "  main:",
      "    releaseId: acme-r000036",
      "    at: 2026-10-14T19:53:51.751Z",
      "    healthy: true",
      "    state: succeeded",
      "    operationId: op-test-0001",
      "    leaseExpiresAt: null",
      "",
    ].join("\n"),
  );
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

test("AC-1: recordSiteRollback writes lastPropagated.main with state rolled-back", async () => {
  const result = await recordSiteRollback({
    workspaceRoot: werkstattRoot,
    systemId,
    channel: "main",
    operationId: "op-test-rollback",
    rollbackTarget: { releaseId: "acme-r000035", versionId: "worker-version-1" },
    io: createDefaultIO().io,
  });

  expect(result.releaseId).toBe("acme-r000035");
  expect(result.stateWritten).toBe(true);

  const state = await readSystemState(werkstattRoot, systemId);
  const main = state.lastPropagated.main;
  expect(main?.releaseId).toBe("acme-r000035");
  expect(main?.state).toBe("rolled-back");
  expect(main?.healthy).toBeNull();
  expect(main?.operationId).toBe("op-test-rollback");
  expect(main?.workerVersionId).toBe("worker-version-1");
});

test("AC-2: recordSiteRollback appends one deployment-rolled-back Bordbuch event", async () => {
  await recordSiteRollback({
    workspaceRoot: werkstattRoot,
    systemId,
    channel: "main",
    operationId: "op-test-rollback",
    rollbackTarget: { releaseId: "acme-r000035" },
    io: createDefaultIO().io,
  });

  const entries = await readBordbuch(werkstattRoot, systemId);
  const rollbacks = entries.filter((e) => e.kind === "deployment-rolled-back");
  expect(rollbacks).toHaveLength(1);
  expect(rollbacks[0].summary).toContain("acme-r000035");
});

test("gateForChannel maps channels to their gates", () => {
  expect(gateForChannel("dev")).toBe("dev-deploy");
  expect(gateForChannel("alt")).toBe("propagate-alt");
  expect(gateForChannel("main")).toBe("promote-main");
});
