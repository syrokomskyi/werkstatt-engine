/*
<MODULE_CONTRACT>
<purpose>RFC-1263 AC-5: regression pin — leitstand.ship still runs the full
mission.validate before any lifecycle/deploy phase; the content fast lane
relaxes only the pre-ship reconcile/close precondition, never ship.</purpose>
<keywords>RFC-1263, leitstand.ship, mission.validate, deploy gate</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1263: initial pin — validate precedes reconcile/close in ship.</item>
  <item>RFC-1263</item>
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

const mockExecuteKernelCommand = executeKernelCommand as unknown as ReturnType<typeof vi.fn>;
const mockIoExec = vi.fn();

const context = {
  io: { ...createDefaultIO().io, exec: mockIoExec },
  workspaceRoot: "/tmp/test-ship-phases",
  logger: { info: () => {}, success: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
} as unknown as KernelRuntimeContext;

let tmpDir: string;

beforeEach(async () => {
  mockExecuteKernelCommand.mockReset();
  mockIoExec.mockReset();
  mockIoExec.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ship-phases-"));
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

test("AC-5: ship runs mission.validate before reconcile/close — a fast-lane record never substitutes", async () => {
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

  const result = await runLeitstandShip(
    { flags: { site: "test-sys", mission: "m000001", until: "closed" }, argv: [] },
    context,
  );

  expect(result.exitCode).toBe(0);
  const order = mockExecuteKernelCommand.mock.calls.map(
    (c) => (c[0] as { commandName: string }).commandName,
  );
  expect(order).toContain("mission.validate");
  expect(order.indexOf("mission.validate")).toBeLessThan(order.indexOf("mission.reconcile"));
  expect(order.indexOf("mission.validate")).toBeLessThan(order.indexOf("mission.close"));
});
