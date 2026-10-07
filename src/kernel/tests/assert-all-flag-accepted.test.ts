import { test, expect } from "vitest";
import { assertAllFlagAccepted } from "../runtime/execute-command.ts";
import type { KernelCommandDefinition } from "@warpgogol/werkstatt-shared/kernel";

/*
<MODULE_CONTRACT>
  <purpose>
    Verify assertAllFlagAccepted guard logic: rejects --all when acceptsAllFlag is not true
    (covers false and undefined), allows --all when acceptsAllFlag is true, and is inactive
    when allSites is false (RFC-0842).
  </purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0842: initial unit test for the --all guard in executeKernelCommand.</item>
  <item>RFC-1231: step 1 — rename supportsAllSites to acceptsAllFlag

Mechanical sweep: the field only ever gated --all argv acceptance; fan-out
follows the parsed selector. Guard renamed assertAllSitesAllowed ->
assertAllFlagAccepted, message updated. 417 declaration sites + type
surfaces (KernelCommandMetadata, ForgeCommandMetadata) in one atomic pass.</item>
</CHANGE_SUMMARY>
*/

function makeCmd(acceptsAllFlag?: boolean): KernelCommandDefinition {
  return {
    name: "test.command",
    modulePath: "test",
    description: "Test command",
    scope: "workspace",
    flags: {},
    acceptsAllFlag,
    execute: async () => ({ exitCode: 0, summary: "noop" }),
  };
}

test("acceptsAllFlag: true + allSites: true → does not throw", () => {
  expect(() => assertAllFlagAccepted(makeCmd(true), true)).not.toThrow();
});

test("acceptsAllFlag: false + allSites: true → throws", () => {
  expect(() => assertAllFlagAccepted(makeCmd(false), true)).toThrow(/does not accept --all/);
});

test("acceptsAllFlag: undefined + allSites: true → throws", () => {
  const cmd = makeCmd(undefined);
  expect(cmd.acceptsAllFlag).toBeUndefined();
  expect(() => assertAllFlagAccepted(cmd, true)).toThrow(/does not accept --all/);
});

test("acceptsAllFlag: false + allSites: false → does not throw (guard inactive)", () => {
  expect(() => assertAllFlagAccepted(makeCmd(false), false)).not.toThrow();
});
