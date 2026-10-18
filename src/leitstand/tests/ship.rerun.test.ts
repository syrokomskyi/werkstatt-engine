/*
<MODULE_CONTRACT>
  <purpose>
    RFC-1327 AC-5: leitstand.ship mission-reconcile step skip — when the mission's
    reconciliation-report.json already records the current workpiece head, the
    step returns skipped:true without invoking mission.reconcile; a head
    mismatch runs the command normally.
  </purpose>
<non-goals>
  <item>Not a full ship-plan execution — the reconcile step is exercised in isolation over tmp fixtures.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1327: initial rerun coverage for the ship reconcile-skip gate.</item>
  <item>RFC-1327: run-twice idempotency — declarations, command.idempotency.validate, rerun tests, reconcile/ship/abort convergence fixes</item>
  <item>RFC-1327: review r1 — lock-safe reconcile gate, residue sweep, honest idempotency classes</item>
</CHANGE_SUMMARY>
*/

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDefaultIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";
import type { ShipContext } from "../ship.ts";

const executeKernelCommandMock = vi.fn<(opts: { commandName: string }) => Promise<unknown>>();

vi.mock("@warpgogol/werkstatt-engine/kernel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@warpgogol/werkstatt-engine/kernel")>();
  return {
    ...actual,
    executeKernelCommand: (opts: { commandName: string }) => executeKernelCommandMock(opts),
  };
});

const { buildShipPlan } = await import("../ship.ts");

function gitInit(dir: string): string {
  execSync("git init -b main", { cwd: dir, stdio: "pipe" });
  execSync("git config user.email test@test.com", { cwd: dir, stdio: "pipe" });
  execSync("git config user.name Test", { cwd: dir, stdio: "pipe" });
  execSync("git commit -qm init --allow-empty", { cwd: dir, stdio: "pipe" });
  return execSync("git rev-parse HEAD", { cwd: dir, encoding: "utf8" }).trim();
}

function makeCtx(root: string, missionId: string): ShipContext {
  return {
    workspaceRoot: root,
    systemId: "acme",
    missionId,
    missionDir: path.join(root, "missions", missionId),
    workpieceDir: path.join(root, "missions", missionId, "workpiece"),
    cacheCloneDir: path.join(root, "systems-cache", "acme"),
    releaseId: null,
    missionClosed: false,
    allowUnreconciled: false,
    logger: { info: () => {}, warn: () => {}, error: () => {}, success: () => {} } as never,
    io: createDefaultIO().io,
  };
}

async function writeReport(ctx: ShipContext, head: string | null): Promise<void> {
  const dir = path.join(ctx.missionDir, "evidence");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "reconciliation-report.json"),
    JSON.stringify({ workpieceHeadAtReconcile: head }) + "\n",
  );
}

describe("leitstand.ship mission-reconcile skip (RFC-1327)", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "ship-rerun-"));
    executeKernelCommandMock.mockReset();
    executeKernelCommandMock.mockResolvedValue({ exitCode: 0, summary: "ok", data: {} });
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  test("skips reconcile when the report already folded the current head", async () => {
    const ctx = makeCtx(root, "acme-m000001");
    await fs.mkdir(ctx.workpieceDir, { recursive: true });
    const head = gitInit(ctx.workpieceDir);
    await writeReport(ctx, head);

    const plan = buildShipPlan({ until: "closed" });
    const step = plan.steps.find((s) => s.name === "mission-reconcile");
    expect(step).toBeDefined();

    const result = (await step!.run(ctx)) as { skipped?: boolean };
    expect(result.skipped).toBe(true);
    expect(
      executeKernelCommandMock.mock.calls.some(
        (c) => c[0].commandName === "mission.reconcile",
      ),
      "mission.reconcile must not be invoked on an already-reconciled head",
    ).toBe(false);
  });

  test("runs reconcile when the recorded head is stale", async () => {
    const ctx = makeCtx(root, "acme-m000002");
    await fs.mkdir(ctx.workpieceDir, { recursive: true });
    gitInit(ctx.workpieceDir);
    await writeReport(ctx, "0".repeat(40));

    const plan = buildShipPlan({ until: "closed" });
    const step = plan.steps.find((s) => s.name === "mission-reconcile")!;
    const result = (await step.run(ctx)) as { skipped?: boolean };

    expect(result.skipped).toBe(false);
    expect(
      executeKernelCommandMock.mock.calls.some((c) => c[0].commandName === "mission.reconcile"),
    ).toBe(true);
  });

  test("runs reconcile when no report exists", async () => {
    const ctx = makeCtx(root, "acme-m000003");
    await fs.mkdir(ctx.workpieceDir, { recursive: true });
    gitInit(ctx.workpieceDir);

    const plan = buildShipPlan({ until: "closed" });
    const step = plan.steps.find((s) => s.name === "mission-reconcile")!;
    await step.run(ctx);
    expect(
      executeKernelCommandMock.mock.calls.some((c) => c[0].commandName === "mission.reconcile"),
    ).toBe(true);
  });
});
