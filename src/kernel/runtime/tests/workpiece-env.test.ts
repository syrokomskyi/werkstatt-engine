/*
<MODULE_CONTRACT>
<purpose>
Unit tests for workpiece env covering context.workpieceEnv contract (RFC-1126, AC-2).
</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>Fixtures stay inline and minimal so each case states its own setup.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-1311: Compass header sweep — declares the workpiece suite's contract for test-file scaffold coverage.</item>
</CHANGE_SUMMARY>
*/
// @ai-invariant fixtures must not couple to kernel internals beyond the public surface under test

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EMPTY_WORKPIECE_ENV, loadWorkpieceEnv } from "@warpgogol/werkstatt-shared/kernel";

describe("context.workpieceEnv contract (RFC-1126, AC-2)", () => {
  let siteDir: string;

  beforeEach(() => {
    siteDir = mkdtempSync(join(tmpdir(), "wp-env-"));
  });

  afterEach(() => {
    rmSync(siteDir, { recursive: true, force: true });
    delete process.env["WP_ENV_TEST_KEY"];
  });

  it("the executor-populated map contains the parsed <site>/.env entries", async () => {
    writeFileSync(join(siteDir, ".env"), "WP_ENV_TEST_KEY=from-file\nOTHER=1\n");
    const workpieceEnv = await loadWorkpieceEnv(siteDir);
    expect(workpieceEnv.get("WP_ENV_TEST_KEY")).toBe("from-file");
    expect(workpieceEnv.get("OTHER")).toBe("1");
  });

  it("process.env takes precedence over the workpiece map", async () => {
    writeFileSync(join(siteDir, ".env"), "WP_ENV_TEST_KEY=from-file\n");
    process.env["WP_ENV_TEST_KEY"] = "from-process";
    const workpieceEnv = await loadWorkpieceEnv(siteDir);
    // The consumer pattern: process.env ?? workpieceEnv.
    const resolved = process.env["WP_ENV_TEST_KEY"] ?? workpieceEnv.get("WP_ENV_TEST_KEY");
    expect(resolved).toBe("from-process");
  });

  it("falls back to the workpiece map when process.env lacks the key", async () => {
    writeFileSync(join(siteDir, ".env"), "WP_ENV_TEST_KEY=from-file\n");
    const workpieceEnv = await loadWorkpieceEnv(siteDir);
    const resolved = process.env["WP_ENV_TEST_KEY"] ?? workpieceEnv.get("WP_ENV_TEST_KEY");
    expect(resolved).toBe("from-file");
  });

  it("workspace-scoped contexts share the empty map", async () => {
    expect(await loadWorkpieceEnv(undefined)).toBe(EMPTY_WORKPIECE_ENV);
    expect(EMPTY_WORKPIECE_ENV.size).toBe(0);
  });
});
