/*
<MODULE_CONTRACT>
<purpose>
Unit tests for pipeline hint covering its documented public contract and regression-sensitive edge cases.
</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>Fixtures stay inline and minimal so each case states its own setup.</item>
</KEY_DECISIONS>

<CHANGE_SUMMARY>
  <item>RFC-0870: initial unit tests for pipelineHint and KNOWN_PIPELINE_NAMES.</item>
</CHANGE_SUMMARY>
*/
// @ai-invariant fixtures must not couple to internals beyond the public surface under test

import { test, expect } from "vitest";
import { pipelineHint, KNOWN_PIPELINE_NAMES } from "./pipeline-hint.ts";

test("pipelineHint returns hint for known pipeline names", () => {
  const hint = pipelineHint("build.prepare");
  expect(hint).toContain("build.prepare");
  expect(hint).toContain("pipeline");
  expect(hint).toContain("werkstatt pipeline build.prepare");
});

test("pipelineHint returns hint for all registered pipeline names", () => {
  for (const name of KNOWN_PIPELINE_NAMES) {
    const hint = pipelineHint(name);
    expect(hint).toContain(name);
    expect(hint.length).toBeGreaterThan(0);
  }
});

test("pipelineHint returns empty string for non-pipeline names", () => {
  expect(pipelineHint("image.variants.generate")).toBe("");
  expect(pipelineHint("mission.validate")).toBe("");
  expect(pipelineHint("")).toBe("");
  expect(pipelineHint("unknown.thing")).toBe("");
});

test("KNOWN_PIPELINE_NAMES includes core pipelines", () => {
  expect(KNOWN_PIPELINE_NAMES.has("build.prepare")).toBe(true);
  expect(KNOWN_PIPELINE_NAMES.has("build.check")).toBe(true);
  expect(KNOWN_PIPELINE_NAMES.has("build.post")).toBe(true);
  expect(KNOWN_PIPELINE_NAMES.has("packages.check")).toBe(true);
});
