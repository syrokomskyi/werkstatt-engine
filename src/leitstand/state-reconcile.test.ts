/*
<MODULE_CONTRACT>
<purpose>RFC-1297: leitstand.state.reconcile handler — writes lastPropagated
with state "reconciled" and a live-state-reconciled Bordbuch event when live ≠
recorded; exits 1 when the live identity is unreachable.</purpose>
<keywords>RFC-1297, leitstand.state.reconcile, live-state-reconciled</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1297: initial — handler test.</item>
  <item>RFC-1297</item>
</CHANGE_SUMMARY>
*/

import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDefaultIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";
import type { KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";
import { runLeitstandStateReconcile } from "./state-reconcile.ts";
import { readSystemState } from "../sternsystem/registry-io.ts";
import { readBordbuch } from "../bordbuch/bordbuch-io.ts";

const mockFetch = vi.fn();

vi.mock("./wba-signer.ts", () => ({
  resolveOutboundAgentClient: vi.fn(async () => ({
    client: { fetch: (...args: unknown[]) => mockFetch(...args) },
  })),
}));

const systemId = "acme";
let tmpDir: string;
let werkstattRoot: string;
let context: KernelRuntimeContext;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  mockFetch.mockReset();
  tmpDir = mkdtempSync(join(tmpdir(), "state-reconcile-"));
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
  context = {
    workspaceRoot: werkstattRoot,
    io: createDefaultIO().io,
    logger: { info: () => {}, success: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  } as unknown as KernelRuntimeContext;
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

const flags = {
  site: systemId,
  channel: "main",
  "from-live": true,
  reason: "operator verified the out-of-band rollback",
};

test("reconciles a drifted channel: state written, Bordbuch event appended", async () => {
  mockFetch.mockResolvedValue(jsonResponse(200, { releaseId: "acme-r000035" }));

  const result = await runLeitstandStateReconcile({ flags, argv: [] }, context);

  expect(result.exitCode).toBe(0);
  const state = await readSystemState(werkstattRoot, systemId);
  const main = state.lastPropagated.main;
  expect(main?.releaseId).toBe("acme-r000035");
  expect(main?.state).toBe("reconciled");
  expect(main?.healthy).toBeNull();

  const entries = await readBordbuch(werkstattRoot, systemId);
  const reconciled = entries.filter((e) => e.kind === "live-state-reconciled");
  expect(reconciled).toHaveLength(1);
  expect(reconciled[0].summary).toContain("acme-r000036");
  expect(reconciled[0].summary).toContain("acme-r000035");
});

test("exits 1 when the live identity is unreachable — nothing truthful to record", async () => {
  mockFetch.mockRejectedValue(new Error("connect ECONNREFUSED"));

  const result = await runLeitstandStateReconcile({ flags, argv: [] }, context);

  expect(result.exitCode).toBe(1);
  const state = await readSystemState(werkstattRoot, systemId);
  expect(state.lastPropagated.main?.releaseId).toBe("acme-r000036");
  const entries = await readBordbuch(werkstattRoot, systemId);
  expect(entries.filter((e) => e.kind === "live-state-reconciled")).toHaveLength(0);
});

test("already-consistent live state exits 0 without writing", async () => {
  mockFetch.mockResolvedValue(jsonResponse(200, { releaseId: "acme-r000036" }));

  const result = await runLeitstandStateReconcile({ flags, argv: [] }, context);

  expect(result.exitCode).toBe(0);
  expect(result.data?.outcome).toBe("already-consistent");
  const entries = await readBordbuch(werkstattRoot, systemId);
  expect(entries.filter((e) => e.kind === "live-state-reconciled")).toHaveLength(0);
});
