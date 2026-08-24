import { test, expect } from "vitest";
import { assertAllSitesAllowed } from "../runtime/execute-command.ts";
import type { KernelCommandDefinition } from "../types.ts";

/*
<MODULE_CONTRACT>
  <purpose>
    Verify assertAllSitesAllowed guard logic: rejects --all when supportsAllSites is not true
    (covers false and undefined), allows --all when supportsAllSites is true, and is inactive
    when allSites is false (RFC-0842).
  </purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0842: initial unit test for the --all guard in executeKernelCommand.</item>
</CHANGE_SUMMARY>
*/

function makeCmd(supportsAllSites?: boolean): KernelCommandDefinition {
  return {
    name: "test.command",
    description: "Test command",
    scope: "workspace",
    flags: {},
    supportsAllSites,
    execute: async () => ({ exitCode: 0, summary: "noop" }),
  };
}

test("supportsAllSites: true + allSites: true → does not throw", () => {
  expect(() => assertAllSitesAllowed(makeCmd(true), true)).not.toThrow();
});

test("supportsAllSites: false + allSites: true → throws", () => {
  expect(() => assertAllSitesAllowed(makeCmd(false), true)).toThrow(
    /does not support --all/,
  );
});

test("supportsAllSites: undefined + allSites: true → throws", () => {
  const cmd = makeCmd(undefined);
  expect(cmd.supportsAllSites).toBeUndefined();
  expect(() => assertAllSitesAllowed(cmd, true)).toThrow(/does not support --all/);
});

test("supportsAllSites: false + allSites: false → does not throw (guard inactive)", () => {
  expect(() => assertAllSitesAllowed(makeCmd(false), false)).not.toThrow();
});
