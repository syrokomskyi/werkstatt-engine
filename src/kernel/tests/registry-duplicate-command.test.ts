import { test, expect } from "vitest";
import { buildActualState } from "../../runtime/reconciler.ts";
import type { CommandDeclaration } from "@warpgogol/werkstatt-shared/kernel";
import type { KernelCommandResult } from "@warpgogol/werkstatt-shared/kernel";
import type { ModuleExport } from "@warpgogol/werkstatt-shared/kernel";

/*
<MODULE_CONTRACT>
  <purpose>
    Verify buildActualState duplicate command detection:
    same command name across modules throws COMPOSITION-02. Prevents pipeline crashes when two modules
    accidentally register the same command (RFC-0816).
  </purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>Fixtures stay inline and minimal so each case states its own setup.</item>
</KEY_DECISIONS>

<CHANGE_SUMMARY>
  <item>RFC-0816: initial regression test for duplicate command registration.</item>
  <item>RFC-1038: migrated from registerCommand to populateFromModule.</item>
  <item>RFC-1038: migrated from KernelRegistry.populateFromModule to buildActualState.</item>
</CHANGE_SUMMARY>
*/
// @ai-invariant fixtures must not couple to internals beyond the public surface under test

const noopExecute = async (): Promise<KernelCommandResult<unknown>> => ({
  exitCode: 0,
  summary: "noop",
});

function makeCmd(name: string): CommandDeclaration {
  return {
    name,
    modulePath: "test",
    description: `Test command ${name}`,
    scope: "workspace",
    flags: {},
    execute: noopExecute as CommandDeclaration["execute"],
  };
}

function makeModule(name: string, commands: CommandDeclaration[]): ModuleExport {
  return {
    name,
    version: "1.0.0",
    declarations: [],
    commands,
    pipelines: [],
  };
}

test("duplicate command name across modules throws", () => {
  const cmdA = makeCmd("test.ping");
  const cmdB = makeCmd("test.ping");
  cmdB.execute = (async () => ({
    exitCode: 1,
    summary: "different",
  })) as CommandDeclaration["execute"];
  expect(() =>
    buildActualState([makeModule("module-a", [cmdA]), makeModule("module-b", [cmdB])]),
  ).toThrow(/COMPOSITION-02.*test\.ping/);
});

test("different command names do not conflict", () => {
  const actual = buildActualState([
    makeModule("module-a", [makeCmd("test.ping")]),
    makeModule("module-b", [makeCmd("test.pong")]),
  ]);
  expect([...actual.commands.keys()].sort()).toEqual(["test.ping", "test.pong"]);
});

test("same command with different execute in same module is rejected", () => {
  const cmdA = makeCmd("test.ping");
  const cmdB = makeCmd("test.ping");
  cmdB.execute = (async () => ({
    exitCode: 1,
    summary: "different",
  })) as CommandDeclaration["execute"];
  expect(() => buildActualState([makeModule("module-a", [cmdA, cmdB])])).toThrow(
    /COMPOSITION-02.*test\.ping/,
  );
});

test("idempotent re-registration with same execute is a no-op (RFC-0816)", () => {
  const cmd = makeCmd("test.ping");
  expect(() =>
    buildActualState([makeModule("module-a", [cmd, makeCmd("test.ping")])]),
  ).not.toThrow();
});
