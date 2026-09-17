import { test, expect, describe, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runWorkflowList, runWorkflowAmendList, runWorkflowLint } from "../handlers.ts";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-shared/kernel";
import type { ActualState } from "@warpgogol/werkstatt-shared/kernel";

let tmpDir: string;

const mockInput: KernelCommandInput = {
  argv: [],
  flags: {},
};

function makeContext(): KernelRuntimeContext {
  return {
    workspaceRoot: tmpDir,
    siteExplicit: false,
    logger: {
      section: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      success: () => {},
      event: () => {},
      getEvents: () => [],
    },
    dryRun: false,
    outputFormat: "json",
    io: {} as never,
    actualState: { commands: new Map(), pipelines: new Map(), components: new Map() } as unknown as ActualState,
  };
}

const VALID_FRONTMATTER = `---
id: wf-001
title: Test Workflow
phase: prepare
reads: []
writes: []
scope:
  allowedWriteRoots: []
  forbiddenWriteRoots:
    - onboarding/.input/
runs: []
recoveryRules: []
agentInvariants: []
selfOrchestration:
  autoRun: false
  pauseFor: []
checkpoints: []
---

Body text.
`;

beforeEach(() => {
  tmpDir = mkdtempSync(join(process.cwd(), "tmp-workflow-handlers-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("runWorkflowList", () => {
  test("returns empty list when no workflow directory exists", async () => {
    const result = await runWorkflowList(mockInput, makeContext());
    expect(result.exitCode).toBe(0);
    expect(result.data!.workflows).toEqual([]);
  });

  test("returns workflow entries when files exist", async () => {
    mkdirSync(join(tmpDir, ".agents/workflows"), { recursive: true });
    writeFileSync(join(tmpDir, ".agents/workflows/wf-001.md"), VALID_FRONTMATTER);
    const result = await runWorkflowList(mockInput, makeContext());
    expect(result.exitCode).toBe(0);
    expect(result.data!.workflows).toHaveLength(1);
    expect(result.data!.workflows[0]!.id).toBe("wf-001");
  });

  test("ignores README.md", async () => {
    mkdirSync(join(tmpDir, ".agents/workflows"), { recursive: true });
    writeFileSync(join(tmpDir, ".agents/workflows/README.md"), VALID_FRONTMATTER);
    writeFileSync(join(tmpDir, ".agents/workflows/wf-001.md"), VALID_FRONTMATTER);
    const result = await runWorkflowList(mockInput, makeContext());
    expect(result.data!.workflows).toHaveLength(1);
  });

  test("summary contains count", async () => {
    const result = await runWorkflowList(mockInput, makeContext());
    expect(result.summary).toContain("workflow.list");
    expect(result.summary).toContain("0");
  });
});

describe("runWorkflowAmendList", () => {
  test("returns empty list when no amend workflow directory exists", async () => {
    const result = await runWorkflowAmendList(mockInput, makeContext());
    expect(result.exitCode).toBe(0);
    expect(result.data!.workflows).toEqual([]);
  });

  test("returns amend workflow entries", async () => {
    mkdirSync(join(tmpDir, ".agents/workflows-amend"), { recursive: true });
    writeFileSync(join(tmpDir, ".agents/workflows-amend/wf-amend-001.md"), VALID_FRONTMATTER);
    const result = await runWorkflowAmendList(mockInput, makeContext());
    expect(result.data!.workflows).toHaveLength(1);
  });
});

describe("runWorkflowLint", () => {
  test("returns exit code 0 with no violations when no workflows exist", async () => {
    const result = await runWorkflowLint(mockInput, makeContext());
    expect(result.exitCode).toBe(0);
    expect(result.data!.violations).toEqual([]);
    expect(result.data!.filesChecked).toBe(0);
  });

  test("returns exit code 0 for valid workflow", async () => {
    mkdirSync(join(tmpDir, ".agents/workflows"), { recursive: true });
    writeFileSync(join(tmpDir, ".agents/workflows/wf-001.md"), VALID_FRONTMATTER);
    const result = await runWorkflowLint(mockInput, makeContext());
    expect(result.exitCode).toBe(0);
    expect(result.data!.violations).toEqual([]);
    expect(result.data!.filesChecked).toBe(1);
  });

  test("returns exit code 1 for invalid frontmatter", async () => {
    mkdirSync(join(tmpDir, ".agents/workflows"), { recursive: true });
    writeFileSync(join(tmpDir, ".agents/workflows/bad.md"), "---\nbroken: true\n---\nbody\n");
    const result = await runWorkflowLint(mockInput, makeContext());
    expect(result.exitCode).toBe(1);
    expect(result.data!.violations.length).toBeGreaterThan(0);
  });

  test("detects WF004 when forbiddenWriteRoots missing onboarding/.input/", async () => {
    mkdirSync(join(tmpDir, ".agents/workflows"), { recursive: true });
    const fm = `---
id: wf-002
title: Test
phase: prepare
reads: []
writes: []
scope:
  allowedWriteRoots: []
  forbiddenWriteRoots: []
runs: []
recoveryRules: []
agentInvariants: []
selfOrchestration:
  autoRun: false
  pauseFor: []
checkpoints: []
---
body
`;
    writeFileSync(join(tmpDir, ".agents/workflows/wf-002.md"), fm);
    const result = await runWorkflowLint(mockInput, makeContext());
    const wf004 = result.data!.violations.find((v) => v.code === "WF004");
    expect(wf004).toBeDefined();
  });

  test("detects WF005 when nextWorkflow references missing id", async () => {
    mkdirSync(join(tmpDir, ".agents/workflows"), { recursive: true });
    const fm = `---
id: wf-003
title: Test
phase: prepare
reads: []
writes: []
scope:
  allowedWriteRoots: []
  forbiddenWriteRoots:
    - onboarding/.input/
runs: []
recoveryRules: []
agentInvariants: []
selfOrchestration:
  autoRun: false
  pauseFor: []
checkpoints: []
nextWorkflow: nonexistent
---
body
`;
    writeFileSync(join(tmpDir, ".agents/workflows/wf-003.md"), fm);
    const result = await runWorkflowLint(mockInput, makeContext());
    const wf005 = result.data!.violations.find((v) => v.code === "WF005");
    expect(wf005).toBeDefined();
  });
});
