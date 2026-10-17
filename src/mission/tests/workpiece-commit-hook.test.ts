/*
<MODULE_CONTRACT>
<purpose>
Unit tests for workpiece commit hook covering installWorkpieceCommitHook. It also guards the documented public contract and regression-sensitive edge cases.
</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1311: Compass header sweep — declares the workpiece suite's contract for test-file scaffold coverage.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, describe, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { installWorkpieceCommitHook } from "../workpiece-commit-hook.ts";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(process.cwd(), "tmp-commit-hook-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("installWorkpieceCommitHook", () => {
  test("returns installed=false when .git does not exist", async () => {
    const result = await installWorkpieceCommitHook(tmpDir);
    expect(result.installed).toBe(false);
  });

  test("returns installed=true when .git exists", async () => {
    mkdirSync(join(tmpDir, ".git"), { recursive: true });
    const result = await installWorkpieceCommitHook(tmpDir);
    expect(result.installed).toBe(true);
    expect(result.hookPath).toContain("pre-commit");
  });

  test("creates hooks directory and pre-commit file", async () => {
    mkdirSync(join(tmpDir, ".git"), { recursive: true });
    await installWorkpieceCommitHook(tmpDir);
    const { existsSync } = await import("node:fs");
    expect(existsSync(join(tmpDir, ".git", "hooks", "pre-commit"))).toBe(true);
  });

  test("pre-commit script contains RFC-0821 guard", async () => {
    mkdirSync(join(tmpDir, ".git"), { recursive: true });
    await installWorkpieceCommitHook(tmpDir);
    const { readFileSync } = await import("node:fs");
    const content = readFileSync(join(tmpDir, ".git", "hooks", "pre-commit"), "utf8");
    expect(content).toContain("MISSION_GIT_COMMIT");
    expect(content).toContain("RFC-0821");
  });

  test("pre-commit script contains RFC-0878 .closed sentinel check", async () => {
    mkdirSync(join(tmpDir, ".git"), { recursive: true });
    await installWorkpieceCommitHook(tmpDir);
    const { readFileSync } = await import("node:fs");
    const content = readFileSync(join(tmpDir, ".git", "hooks", "pre-commit"), "utf8");
    expect(content).toContain(".closed");
    expect(content).toContain("RFC-0878");
  });
});
