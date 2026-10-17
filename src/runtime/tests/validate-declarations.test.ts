/*
<MODULE_CONTRACT>
<purpose>
Unit tests for validate declarations covering RFC-1173: collectDeclarationDiagnostics — MUTATES-STATE-DECLARED; RFC-1173: collectDeclarationDiagnostics — MUTATES-STATE-WRITES-MISMATCH.
</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1311: Compass header sweep — declares the validate suite's contract for test-file scaffold coverage.</item>
</CHANGE_SUMMARY>
*/

import "./load-verification.test.ts";

import { describe, expect, it, vi } from "vitest";
import type { CommandDeclaration } from "@warpgogol/werkstatt-shared/kernel";
import { collectDeclarationDiagnostics, validateDeclarations } from "../validate-declarations.ts";

function baseCommand(over: Partial<CommandDeclaration> = {}): CommandDeclaration {
  return {
    name: "sample.validate",
    modulePath: "packages/x/src/checks/sample-validate.ts",
    description: "sample validator",
    scope: "workspace",
    flags: {},
    mutatesState: false,
    contract: "sample",
    rules: [],
    execute: async () => ({ data: null, exitCode: 0, summary: "ok" }),
    ...over,
  };
}

describe("RFC-1173: collectDeclarationDiagnostics — MUTATES-STATE-DECLARED", () => {
  it("emits an error diagnostic when mutatesState is absent", () => {
    const cmd = baseCommand();
    delete (cmd as { mutatesState?: boolean }).mutatesState;
    const commands = new Map<string, CommandDeclaration>([[cmd.name, cmd]]);

    const diagnostics = collectDeclarationDiagnostics(commands);
    const hit = diagnostics.find(
      (d) => d.ruleId === "MUTATES-STATE-DECLARED" && d.command === "sample.validate",
    );
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe("error");
    expect(hit?.message).toContain("mutatesState");
  });

  it("is silent for both mutating and read-only declarations", () => {
    const commands = new Map<string, CommandDeclaration>([
      ["a.validate", baseCommand({ name: "a.validate", mutatesState: false })],
      [
        "b.generate",
        baseCommand({
          name: "b.generate",
          mutatesState: true,
          generates: [{ path: "dist/x.js", phase: "build.post" }],
        }),
      ],
    ]);
    const diagnostics = collectDeclarationDiagnostics(commands);
    expect(diagnostics.filter((d) => d.ruleId === "MUTATES-STATE-DECLARED")).toHaveLength(0);
  });

  it("skips non-platform registrations without modulePath", () => {
    const cmd = baseCommand({ modulePath: undefined });
    delete (cmd as { mutatesState?: boolean }).mutatesState;
    const commands = new Map<string, CommandDeclaration>([[cmd.name, cmd]]);

    const diagnostics = collectDeclarationDiagnostics(commands);
    expect(diagnostics.find((d) => d.ruleId === "MUTATES-STATE-DECLARED")).toBeUndefined();
  });

  it("validateDeclarations stays warn-only: logs diagnostics, never throws", () => {
    const cmd = baseCommand();
    delete (cmd as { mutatesState?: boolean }).mutatesState;
    const commands = new Map<string, CommandDeclaration>([[cmd.name, cmd]]);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(() => validateDeclarations(commands)).not.toThrow();
      const out = warn.mock.calls.map((c) => String(c[0])).join("\n");
      expect(out).toContain("MUTATES-STATE-DECLARED");
      expect(out).toContain("sample.validate");
    } finally {
      warn.mockRestore();
    }
  });
});

describe("RFC-1173: collectDeclarationDiagnostics — MUTATES-STATE-WRITES-MISMATCH", () => {
  it("warns when mutatesState:false but writes are declared", () => {
    const cmd = baseCommand({ mutatesState: false, writes: ["dist/out.json"] });
    const commands = new Map<string, CommandDeclaration>([[cmd.name, cmd]]);

    const hit = collectDeclarationDiagnostics(commands).find(
      (d) => d.ruleId === "MUTATES-STATE-WRITES-MISMATCH" && d.command === "sample.validate",
    );
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe("warn");
  });

  it("warns when mutatesState:false but generates are declared", () => {
    const cmd = baseCommand({
      mutatesState: false,
      generates: [{ path: "dist/x.js", phase: "build.post" }],
    });
    const commands = new Map<string, CommandDeclaration>([[cmd.name, cmd]]);

    const hit = collectDeclarationDiagnostics(commands).find(
      (d) => d.ruleId === "MUTATES-STATE-WRITES-MISMATCH" && d.command === "sample.validate",
    );
    expect(hit).toBeDefined();
  });

  it("is silent when mutatesState matches declared outputs", () => {
    const commands = new Map<string, CommandDeclaration>([
      [
        "a.generate",
        baseCommand({
          name: "a.generate",
          mutatesState: true,
          generates: [{ path: "dist/x.js", phase: "build.post" }],
        }),
      ],
      ["b.validate", baseCommand({ name: "b.validate", mutatesState: false })],
    ]);
    const diagnostics = collectDeclarationDiagnostics(commands);
    expect(diagnostics.filter((d) => d.ruleId === "MUTATES-STATE-WRITES-MISMATCH")).toHaveLength(0);
  });
});
