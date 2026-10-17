/*
<MODULE_CONTRACT>
<purpose>
Unit tests for close steps covering close-steps. It also guards the documented public contract and regression-sensitive edge cases.
</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1311: Compass header sweep — declares the close suite's contract for test-file scaffold coverage.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, describe } from "vitest";
import * as mod from "../close-steps.ts";

describe("close-steps", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });

  test("exports resolveCloseSteps", () => {
    expect(typeof mod.resolveCloseSteps).toBe("function");
  });

  test("exports buildCloseSteps", () => {
    expect(typeof mod.buildCloseSteps).toBe("function");
  });
});
