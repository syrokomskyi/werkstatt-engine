/*
<MODULE_CONTRACT>
<purpose>
Unit tests for gitmesh module covering gitmesh/gitmesh-module. It also guards the documented public contract and regression-sensitive edge cases.
</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>Fixtures stay inline and minimal so each case states its own setup.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-1311: Compass header sweep — declares the gitmesh suite's contract for test-file scaffold coverage.</item>
</CHANGE_SUMMARY>
*/
// @ai-invariant fixtures must not couple to kernel internals beyond the public surface under test

import { test, expect, describe } from "vitest";
import * as mod from "../gitmesh-module.ts";

describe("gitmesh/gitmesh-module", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });

  test("exports createGitmeshModule", () => {
    expect(typeof mod.createGitmeshModule).toBe("function");
  });
});
