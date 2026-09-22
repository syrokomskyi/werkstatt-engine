/*
<MODULE_CONTRACT>
<purpose>Unit tests for deployment-optional Sternsystem semantics (RFC-1125) — a system without deployment.channels validates clean and leitstand commands degrade gracefully instead of crashing.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1125: deployment-optional tests — validate emits no deployment violations without deployment config; leitstand.health returns state "unknown" rather than throwing.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { runSternsystemValidate } from "../sternsystem-validate.ts";
import { runLeitstandHealth } from "../../leitstand/leitstand-commands.ts";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";

let testRoot: string;
let workspaceRoot: string;
let cacheRoot: string;
const systemId = "acme";

beforeEach(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sternsystem-deploy-opt-"));
  workspaceRoot = path.join(testRoot, "workspace");
  cacheRoot = path.join(testRoot, "systems-cache");
  await fs.mkdir(workspaceRoot, { recursive: true });
  await fs.mkdir(path.join(cacheRoot, systemId), { recursive: true });
  // Minimal system-config.yaml — NO deployment block (deployment-optional per RFC-1125)
  await fs.writeFile(
    path.join(cacheRoot, systemId, "system-config.yaml"),
    [
      `schemaVersion: "1.0.0"`,
      `id: "${systemId}"`,
      `cosmicStar: "Acamar"`,
      `mirrors:`,
      `  - path: "../systems-cache/${systemId}"`,
      `    storageType: "non-bare"`,
      `pinnedPlatform: "1.0.0"`,
      `status: "registered"`,
      `registeredAt: "2026-09-22T00:00:00.000Z"`,
      `notes: ""`,
    ].join("\n") + "\n",
    "utf8",
  );
});

afterEach(async () => {
  await fs.rm(testRoot, { recursive: true, force: true });
});

function makeInput(flags: Record<string, boolean | string | string[]> = {}): KernelCommandInput {
  return { flags, argv: [] } as unknown as KernelCommandInput;
}

function makeContext(): KernelRuntimeContext {
  return {
    workspaceRoot,
    logger: { info: () => {}, warn: () => {}, error: () => {}, success: () => {} },
  } as unknown as KernelRuntimeContext;
}

test("sternsystem.validate emits no deployment violations when deployment is absent", async () => {
  const result = await runSternsystemValidate(makeInput({ id: systemId }), makeContext());
  const violations = result.data?.violations ?? [];
  const deploymentViolations = violations.filter(
    (v) => v.rule.includes("deploy") || v.rule.includes("channel") || v.message.includes("deployment"),
  );
  expect(
    deploymentViolations,
    `deployment-optional system must not produce deployment violations, got: ${JSON.stringify(deploymentViolations)}`,
  ).toHaveLength(0);
});

test("leitstand.health degrades to state 'unknown' without deployment config", async () => {
  const result = await runLeitstandHealth(makeInput({ site: systemId }), makeContext());
  expect(result.exitCode).toBe(0);
  expect(result.data?.state).toBe("unknown");
  expect(result.summary).toContain("no deployment config");
});
