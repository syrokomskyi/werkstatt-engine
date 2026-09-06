import { test, expect, describe } from "vitest";
import {
  WORKFLOW_PHASES,
  WORKFLOW_CHAINS,
  type WorkflowPhase,
  type WorkflowChain,
  type WorkflowFrontmatter,
  type WorkflowListEntry,
  type WorkflowLintViolation,
  type WorkflowLintResult,
  type WorkflowPreconditions,
  type WorkflowBranch,
  type WorkflowScope,
  type WorkflowRecoveryRule,
  type WorkflowSelfOrchestration,
} from "../types.ts";

describe("WORKFLOW_PHASES", () => {
  test("contains 7 phases", () => {
    expect(WORKFLOW_PHASES).toHaveLength(7);
  });

  test("includes prepare, synthesize, scaffold, compose, author, audit, handoff", () => {
    expect(WORKFLOW_PHASES).toContain("prepare");
    expect(WORKFLOW_PHASES).toContain("synthesize");
    expect(WORKFLOW_PHASES).toContain("scaffold");
    expect(WORKFLOW_PHASES).toContain("compose");
    expect(WORKFLOW_PHASES).toContain("author");
    expect(WORKFLOW_PHASES).toContain("audit");
    expect(WORKFLOW_PHASES).toContain("handoff");
  });

  test("is a const tuple (readonly at type level)", () => {
    // `as const` makes the type readonly; runtime is a regular array
    expect(Array.isArray(WORKFLOW_PHASES)).toBe(true);
  });
});

describe("WORKFLOW_CHAINS", () => {
  test("contains greenfield and amend", () => {
    expect(WORKFLOW_CHAINS).toContain("greenfield");
    expect(WORKFLOW_CHAINS).toContain("amend");
  });

  test("has exactly 2 chains", () => {
    expect(WORKFLOW_CHAINS).toHaveLength(2);
  });
});

describe("type instantiation", () => {
  test("WorkflowFrontmatter can be instantiated", () => {
    const fm: WorkflowFrontmatter = {
      id: "wf-001",
      title: "Test Workflow",
      phase: "prepare",
      reads: [],
      writes: [],
      scope: { allowedWriteRoots: [], forbiddenWriteRoots: [] },
      runs: [],
      recoveryRules: [],
      agentInvariants: [],
      selfOrchestration: { autoRun: false, pauseFor: [] },
      checkpoints: [],
    };
    expect(fm.id).toBe("wf-001");
    expect(fm.phase).toBe("prepare");
  });

  test("WorkflowFrontmatter with optional fields", () => {
    const fm: WorkflowFrontmatter = {
      id: "wf-002",
      title: "Amend Workflow",
      phase: "compose",
      chain: "amend",
      preconditions: { appPresent: true },
      branch: { on: "routeType", cases: ["new", "existing"] },
      reads: ["src/"],
      writes: ["dist/"],
      scope: { allowedWriteRoots: ["src/"], forbiddenWriteRoots: ["node_modules/"] },
      runs: ["cmd.a", "cmd.b"],
      recoveryRules: [{ on: "fail", do: "retry" }],
      agentInvariants: ["no-delete"],
      selfOrchestration: { autoRun: true, pauseFor: ["approval"] },
      checkpoints: ["cp-1"],
      nextWorkflow: "wf-003",
    };
    expect(fm.chain).toBe("amend");
    expect(fm.preconditions!.appPresent).toBe(true);
    expect(fm.nextWorkflow).toBe("wf-003");
  });

  test("WorkflowListEntry can be instantiated", () => {
    const entry: WorkflowListEntry = {
      id: "wf-001",
      title: "Test",
      phase: "prepare",
      file: "workflows/wf-001.md",
      reads: [],
      writes: [],
      runs: [],
    };
    expect(entry.id).toBe("wf-001");
  });

  test("WorkflowLintViolation can be instantiated", () => {
    const v: WorkflowLintViolation = {
      file: "workflows/wf-001.md",
      code: "WF-001",
      message: "Missing field",
    };
    expect(v.code).toBe("WF-001");
  });

  test("WorkflowLintResult can be instantiated", () => {
    const r: WorkflowLintResult = {
      command: "workflow.lint",
      workflowDirectory: ".agents/workflows",
      filesChecked: 5,
      violations: [],
    };
    expect(r.command).toBe("workflow.lint");
    expect(r.filesChecked).toBe(5);
  });

  test("WorkflowPreconditions can be instantiated", () => {
    const p: WorkflowPreconditions = { appPresent: true, systemManifestValid: false };
    expect(p.appPresent).toBe(true);
  });

  test("WorkflowBranch can be instantiated", () => {
    const b: WorkflowBranch = { on: "routeType", cases: ["new"] };
    expect(b.cases).toHaveLength(1);
  });

  test("WorkflowScope can be instantiated", () => {
    const s: WorkflowScope = { allowedWriteRoots: ["src/"], forbiddenWriteRoots: [] };
    expect(s.allowedWriteRoots).toHaveLength(1);
  });

  test("WorkflowRecoveryRule can be instantiated", () => {
    const r: WorkflowRecoveryRule = { on: "fail", do: "retry" };
    expect(r.do).toBe("retry");
  });

  test("WorkflowSelfOrchestration can be instantiated", () => {
    const s: WorkflowSelfOrchestration = { autoRun: true, pauseFor: ["approval"] };
    expect(s.autoRun).toBe(true);
  });
});
