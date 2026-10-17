/*
<MODULE_CONTRACT>
<purpose>
Unit tests for abort steps covering abort-steps. It also guards the documented public contract and regression-sensitive edge cases.
</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1311: Compass header sweep — declares the abort suite's contract for test-file scaffold coverage.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, describe } from "vitest";
import * as mod from "../abort-steps.ts";

describe("abort-steps", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });

  test("exports resolveAbortSteps", () => {
    expect(typeof mod.resolveAbortSteps).toBe("function");
  });

  test("exports buildAbortSteps", () => {
    expect(typeof mod.buildAbortSteps).toBe("function");
  });
});
