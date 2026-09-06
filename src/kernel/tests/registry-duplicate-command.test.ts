import { test, expect } from "vitest";
import { KernelRegistry } from "../registry.ts";
import type { KernelCommandDefinition, KernelCommandResult } from "../types.ts";
import type { ModuleExport } from "../../runtime/desired-state.ts";

/*
<MODULE_CONTRACT>
  <purpose>
    Verify KernelRegistry.populateFromModule duplicate command detection:
    same command name across modules throws. Prevents pipeline crashes when two modules
    accidentally register the same command (RFC-0816).
  </purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0816: initial regression test for duplicate command registration.</item>
  <item>RFC-1038: migrated from registerCommand to populateFromModule.</item>
</CHANGE_SUMMARY>
*/

const noopExecute = async (): Promise<KernelCommandResult<unknown>> => ({
  exitCode: 0,
  summary: "noop",
});

function makeCmd(name: string): KernelCommandDefinition {
  return {
    name,
    modulePath: "test",
    description: `Test command ${name}`,
    scope: "workspace",
    flags: {},
    execute: noopExecute as KernelCommandDefinition["execute"],
  };
}

function makeModule(name: string, commands: KernelCommandDefinition[]): ModuleExport {
  return {
    name,
    version: "1.0.0",
    declarations: [],
    commands,
    pipelines: [],
  };
}

test("duplicate command name across modules throws", () => {
  const registry = new KernelRegistry();
  registry.populateFromModule(makeModule("module-a", [makeCmd("test.ping")]));

  expect(() => registry.populateFromModule(makeModule("module-b", [makeCmd("test.ping")]))).toThrow(
    /already registered: test\.ping/,
  );
});

test("different command names do not conflict", () => {
  const registry = new KernelRegistry();
  registry.populateFromModule(makeModule("module-a", [makeCmd("test.ping")]));
  expect(() =>
    registry.populateFromModule(makeModule("module-b", [makeCmd("test.pong")])),
  ).not.toThrow();
  expect(registry.listCommandNames()).toEqual(["test.ping", "test.pong"]);
});

test("same command in same module is rejected", () => {
  const registry = new KernelRegistry();
  expect(() =>
    registry.populateFromModule(
      makeModule("module-a", [makeCmd("test.ping"), makeCmd("test.ping")]),
    ),
  ).toThrow(/already registered: test\.ping/);
});
