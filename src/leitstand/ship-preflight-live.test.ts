/*
<MODULE_CONTRACT>
<purpose>RFC-1297 AC-5: leitstand.ship preflight throws a live-drift error when
the stubbed channel states contain a recorded-vs-live mismatch (LIVE-01).
readLiveChannelStates is injected via a module seam — no network in tests.</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1297: initial — AC-5 probe.</item>
  <item>RFC-1297</item>
</CHANGE_SUMMARY>
*/

import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { runLeitstandShip } from "./ship.ts";
import { executeKernelCommand } from "@warpgogol/werkstatt-engine/kernel";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";
import { createDefaultIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";

const { mockReadLiveChannelStates } = vi.hoisted(() => ({
  mockReadLiveChannelStates: vi.fn(),
}));

vi.mock("@warpgogol/werkstatt-engine/kernel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@warpgogol/werkstatt-engine/kernel")>();
  return { ...actual, executeKernelCommand: vi.fn() };
});

vi.mock("../kernel/runtime/registry-cache.ts", () => ({
  getOrBuildWorkspaceRegistry: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@warpgogol/werkstatt-site/checks", () => ({
  ensureChromium: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("../sternsystem/registry-io.ts", () => ({
  resolveCacheClonePath: vi.fn((workspaceRoot: string, systemId: string) =>
    path.join(workspaceRoot, "systems-cache", systemId),
  ),
}));

vi.mock("../sternsystem/live-drift.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../sternsystem/live-drift.ts")>();
  return { ...actual, readLiveChannelStates: mockReadLiveChannelStates };
});

const mockExecuteKernelCommand = executeKernelCommand as unknown as ReturnType<typeof vi.fn>;
const mockIoExec = vi.fn();

const context = {
  io: { ...createDefaultIO().io, exec: mockIoExec },
  workspaceRoot: "/tmp/test-ship-preflight-live",
  logger: { info: () => {}, success: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
} as unknown as KernelRuntimeContext;

let tmpDir: string;

beforeEach(async () => {
  mockExecuteKernelCommand.mockReset();
  mockReadLiveChannelStates.mockReset();
  mockIoExec.mockReset();
  mockIoExec.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ship-preflight-live-"));
  await fs.mkdir(path.join(tmpDir, "systems-cache", "test-sys", "operations"), {
    recursive: true,
  });
  const envPath = path.join(tmpDir, "missions", "m000001", "workpiece", ".env");
  await fs.mkdir(path.dirname(envPath), { recursive: true });
  await fs.writeFile(envPath, "TEST=1\n");
  (context as unknown as { workspaceRoot: string }).workspaceRoot = tmpDir;
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("AC-5: ship preflight throws live drift when recorded ≠ live", async () => {
  for (const name of ["leitstand.status"]) {
    mockExecuteKernelCommand.mockImplementationOnce(async () => ({
      exitCode: 0,
      data: {},
      summary: `[${name}] ok`,
    }));
  }
  mockReadLiveChannelStates.mockResolvedValue([
    {
      channel: "main",
      recordedReleaseId: "acme-r000036",
      liveReleaseId: "acme-r000035",
      reachable: true,
      error: null,
    },
  ]);

  const result = await runLeitstandShip(
    { flags: { site: "test-sys", mission: "m000001", until: "closed" }, argv: [] },
    context,
  );

  expect(result.exitCode).toBe(1);
  expect(result.summary).toContain("live drift");
  expect(result.summary).toContain("acme-r000035");
  expect(mockExecuteKernelCommand.mock.calls.map((c) => c[0].commandName)).not.toContain(
    "mission.reconcile",
  );
});

test("matching live state lets preflight continue past the drift check", async () => {
  for (const name of [
    "leitstand.status",
    "agent.search.warm",
    "mission.validate",
    "mission.reconcile",
    "mission.close",
  ]) {
    mockExecuteKernelCommand.mockImplementationOnce(async () => ({
      exitCode: 0,
      data: {},
      summary: `[${name}] ok`,
    }));
  }
  mockReadLiveChannelStates.mockResolvedValue([
    {
      channel: "main",
      recordedReleaseId: "acme-r000036",
      liveReleaseId: "acme-r000036",
      reachable: true,
      error: null,
    },
  ]);

  const result = await runLeitstandShip(
    { flags: { site: "test-sys", mission: "m000001", until: "closed" }, argv: [] },
    context,
  );

  expect(result.exitCode).toBe(0);
});
