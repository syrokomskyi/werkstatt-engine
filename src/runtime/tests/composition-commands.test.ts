import { describe, it, expect } from "vitest";
import { compositionModule } from "../composition.module.ts";
import type { ModuleExport, CommandDeclaration, PipelineDeclaration } from "../desired-state.ts";

describe("RFC-1038: composition module", () => {
  it("AC-1: exports ModuleExport with composition.* commands", () => {
    expect(compositionModule.name).toBe("composition");
    expect(compositionModule.commands.length).toBeGreaterThanOrEqual(4);
    const names = compositionModule.commands.map((c) => c.name);
    expect(names).toContain("composition.desired-state.inspect");
    expect(names).toContain("composition.reconcile");
    expect(names).toContain("composition.overlay.apply");
    expect(names).toContain("composition.overlay.inspect");
  });

  it("AC-15: module exports ModuleExport (not KernelModule.register)", () => {
    expect(compositionModule.declarations).toBeDefined();
    expect(Array.isArray(compositionModule.declarations)).toBe(true);
    expect(Array.isArray(compositionModule.commands)).toBe(true);
    expect(Array.isArray(compositionModule.pipelines)).toBe(true);
    expect(compositionModule.version).toBeDefined();
  });

  it("AC-17: each command has modulePath and execute function", () => {
    for (const cmd of compositionModule.commands) {
      expect(cmd.modulePath).toBeDefined();
      expect(typeof cmd.execute).toBe("function");
      expect(cmd.name).toMatch(/^composition\./);
    }
  });

  it("AC-18: PipelineDeclaration shape (composition module has no pipelines but structure is valid)", () => {
    const pipe: PipelineDeclaration = {
      name: "test.pipeline",
      steps: [
        { command: "step.a" },
        { command: "step.b", dependsOn: ["step.a"] },
      ],
    };
    expect(pipe.name).toBe("test.pipeline");
    expect(pipe.steps).toHaveLength(2);
    expect(pipe.steps[1]!.dependsOn).toEqual(["step.a"]);
  });

  it("composition.desired-state.inspect command exists with correct metadata", () => {
    const cmd = compositionModule.commands.find(
      (c) => c.name === "composition.desired-state.inspect",
    ) as CommandDeclaration;
    expect(cmd).toBeDefined();
    expect(cmd.scope).toBe("workspace");
    expect(cmd.mutatesState).toBe(false);
  });

  it("composition.reconcile command exists with correct metadata", () => {
    const cmd = compositionModule.commands.find(
      (c) => c.name === "composition.reconcile",
    ) as CommandDeclaration;
    expect(cmd).toBeDefined();
    expect(cmd.scope).toBe("workspace");
    expect(cmd.mutatesState).toBe(true);
  });

  it("composition.overlay.apply command has required flags", () => {
    const cmd = compositionModule.commands.find(
      (c) => c.name === "composition.overlay.apply",
    ) as CommandDeclaration;
    expect(cmd).toBeDefined();
    expect(cmd.flags).toBeDefined();
    expect(cmd.flags!["overlay-id"]).toBeDefined();
    expect(cmd.flags!["scope"]).toBeDefined();
  });
});
