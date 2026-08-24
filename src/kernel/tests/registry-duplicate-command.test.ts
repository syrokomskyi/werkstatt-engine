import { test, expect } from "vitest";
import { KernelRegistry } from "../registry.ts";
import type { KernelCommandDefinition, KernelCommandResult } from "../types.ts";

/*
<MODULE_CONTRACT>
  <purpose>
    Verify KernelRegistry.registerCommand idempotency: same-execute re-registration is a no-op,
    different-execute re-registration throws. Prevents pipeline crashes when two modules
    accidentally register the same command with the same handler (RFC-0816).
  </purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0816: initial regression test for duplicate command registration.</item>
</CHANGE_SUMMARY>
*/

const noopExecute = async (): Promise<KernelCommandResult<unknown>> => ({
  exitCode: 0,
  summary: "noop",
});
const otherExecute = async (): Promise<KernelCommandResult<unknown>> => ({
  exitCode: 0,
  summary: "other",
});

function makeCmd(
  name: string,
  execute: () => Promise<KernelCommandResult<unknown>>,
): KernelCommandDefinition {
  return {
    name,
    description: `Test command ${name}`,
    scope: "workspace",
    flags: {},
    execute: execute as KernelCommandDefinition["execute"],
  };
}

test("same-execute re-registration is idempotent (no throw)", () => {
  const registry = new KernelRegistry();
  const cmd = makeCmd("test.ping", noopExecute);

  registry.registerCommand(cmd);
  expect(() => registry.registerCommand(cmd)).not.toThrow();
  expect(registry.getCommand("test.ping")).toBe(cmd);
});

test("different-execute re-registration throws", () => {
  const registry = new KernelRegistry();
  registry.registerCommand(makeCmd("test.ping", noopExecute));

  expect(() => registry.registerCommand(makeCmd("test.ping", otherExecute))).toThrow(
    /already registered: test\.ping/,
  );
});

test("different command names do not conflict", () => {
  const registry = new KernelRegistry();
  registry.registerCommand(makeCmd("test.ping", noopExecute));
  expect(() => registry.registerCommand(makeCmd("test.pong", noopExecute))).not.toThrow();
  expect(registry.listCommandNames()).toEqual(["test.ping", "test.pong"]);
});
