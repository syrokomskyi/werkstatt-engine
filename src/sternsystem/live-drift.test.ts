/*
<MODULE_CONTRACT>
<purpose>RFC-1297: unit tests for live-channel drift — readLiveChannelStates +
liveDriftDiagnostics. AC-3: live ≠ recorded produces a LIVE-01 error. AC-4:
unreachable produces a LIVE-02 warning. Channels without lastPropagated are
skipped.</purpose>
<keywords>RFC-1297, LIVE-01, LIVE-02, live drift, build-identity</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1297: initial — AC-3/AC-4 probes.</item>
  <item>RFC-1297</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDefaultIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";
import { readLiveChannelStates, liveDriftDiagnostics } from "./live-drift.ts";

const systemId = "acme";
let tmpDir: string;
let werkstattRoot: string;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "live-drift-"));
  werkstattRoot = join(tmpDir, "werkstatt");
  const cacheDir = join(tmpDir, "systems-cache", systemId);
  mkdirSync(werkstattRoot, { recursive: true });
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(
    join(cacheDir, "system-config.yaml"),
    [
      "schemaVersion: 1.0.0",
      `id: ${systemId}`,
      "cosmicStar: Vega",
      "mirrors:",
      "  - path: ../systems-cache/acme",
      "    storageType: non-bare",
      "pinnedPlatform: 6.346.1",
      "status: active",
      "registeredAt: 2026-01-01T00:00:00.000Z",
      "deployment:",
      "  adapter: cloudflare-workers",
      "  channels:",
      "    dev:",
      "      workerName: dev-acme",
      "      url: https://dev.example.com",
      "    alt:",
      "      workerName: alt-acme",
      "      url: https://alt.example.com",
      "    main:",
      "      workerName: acme",
      "      url: https://example.com",
      "",
    ].join("\n"),
  );
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function writeState(lastPropagated: Record<string, { releaseId: string }>) {
  const lines = [
    "schemaVersion: 1.0.0",
    `systemId: ${systemId}`,
    "currentMission: null",
    "lastRelease: null",
  ];
  const entries = Object.entries(lastPropagated);
  if (entries.length === 0) {
    lines.push("lastPropagated: {}");
  } else {
    lines.push("lastPropagated:");
    for (const [channel, entry] of entries) {
      lines.push(
        `  ${channel}:`,
        `    releaseId: ${entry.releaseId}`,
        "    at: 2026-10-14T19:53:51.751Z",
        "    healthy: true",
        "    state: succeeded",
        "    operationId: op-test-0001",
        "    leaseExpiresAt: null",
      );
    }
  }
  writeFileSync(
    join(tmpDir, "systems-cache", systemId, "system-state.yaml"),
    lines.join("\n") + "\n",
  );
}

test("AC-3: live releaseId differing from recorded produces a LIVE-01 error", async () => {
  writeState({ main: { releaseId: "acme-r000036" } });
  const fetchImpl = (async () => jsonResponse(200, { releaseId: "acme-r000035" })) as typeof fetch;

  const states = await readLiveChannelStates({
    workspaceRoot: werkstattRoot,
    systemId,
    io: createDefaultIO().io,
    fetchImpl,
  });

  expect(states).toHaveLength(1);
  expect(states[0].channel).toBe("main");
  expect(states[0].recordedReleaseId).toBe("acme-r000036");
  expect(states[0].liveReleaseId).toBe("acme-r000035");

  const diagnostics = liveDriftDiagnostics(states, systemId);
  const live01 = diagnostics.filter((d) => d.ruleId === "LIVE-01");
  expect(live01).toHaveLength(1);
  expect(live01[0].severity).toBe("error");
  expect(live01[0].message).toContain("acme-r000035");
  expect(live01[0].message).toContain("acme-r000036");
  expect(live01[0].fixHint).toContain("leitstand.state.reconcile");
});

test("AC-4: unreachable channel produces a LIVE-02 warning, never an error", async () => {
  writeState({ main: { releaseId: "acme-r000036" } });
  const fetchImpl = (async () => {
    throw new Error("connect ECONNREFUSED");
  }) as typeof fetch;

  const states = await readLiveChannelStates({
    workspaceRoot: werkstattRoot,
    systemId,
    io: createDefaultIO().io,
    fetchImpl,
  });
  const diagnostics = liveDriftDiagnostics(states, systemId);

  expect(diagnostics.filter((d) => d.ruleId === "LIVE-01")).toHaveLength(0);
  const live02 = diagnostics.filter((d) => d.ruleId === "LIVE-02");
  expect(live02).toHaveLength(1);
  expect(live02[0].severity).toBe("warning");
});

test("a channel without lastPropagated is skipped — never deployed, nothing to drift from", async () => {
  writeState({});
  const fetchImpl = (async () => jsonResponse(200, { releaseId: "acme-r000035" })) as typeof fetch;

  const states = await readLiveChannelStates({
    workspaceRoot: werkstattRoot,
    systemId,
    io: createDefaultIO().io,
    fetchImpl,
  });
  expect(states).toHaveLength(0);
  expect(liveDriftDiagnostics(states, systemId)).toHaveLength(0);
});

test("a matching live release produces no diagnostics", async () => {
  writeState({ main: { releaseId: "acme-r000036" } });
  const fetchImpl = (async () => jsonResponse(200, { releaseId: "acme-r000036" })) as typeof fetch;

  const states = await readLiveChannelStates({
    workspaceRoot: werkstattRoot,
    systemId,
    io: createDefaultIO().io,
    fetchImpl,
  });
  expect(liveDriftDiagnostics(states, systemId)).toHaveLength(0);
});

test("a 404 identity is LIVE-02, not LIVE-01 — missing identity is a deployment problem", async () => {
  writeState({ main: { releaseId: "acme-r000036" } });
  const fetchImpl = (async () => jsonResponse(404, {})) as typeof fetch;

  const states = await readLiveChannelStates({
    workspaceRoot: werkstattRoot,
    systemId,
    io: createDefaultIO().io,
    fetchImpl,
  });
  const diagnostics = liveDriftDiagnostics(states, systemId);
  expect(diagnostics.map((d) => d.ruleId)).toEqual(["LIVE-02"]);
});
