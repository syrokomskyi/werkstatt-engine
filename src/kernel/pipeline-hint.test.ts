/*
<MODULE_CONTRACT>
<purpose>RFC-0870: Unit tests for pipeline hint utility.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0870: initial unit tests for pipelineHint and KNOWN_PIPELINE_NAMES.</item>
</CHANGE_SUMMARY>
*/

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
