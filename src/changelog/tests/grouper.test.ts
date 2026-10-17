/*
<MODULE_CONTRACT>
<purpose>
Unit tests for grouper covering deterministicGroup. It also guards the documented public contract and regression-sensitive edge cases.
</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1311: Compass header sweep — declares the grouper suite's contract for test-file scaffold coverage.</item>
</CHANGE_SUMMARY>
*/

import { describe, it, expect } from "vitest";
import { deterministicGroup } from "../changelog/agents/grouper-agent.ts";
import type { ClassifiedCommit } from "../changelog/types.ts";

function makeClassified(
  overrides: Partial<ClassifiedCommit> & { hash: string; module: string },
): ClassifiedCommit {
  return {
    type: "feat",
    severity: "minor",
    summary: "some change",
    isConventional: true,
    isBreaking: false,
    confidence: 0.95,
    ...overrides,
  };
}

describe("deterministicGroup", () => {
  it("returns the provided date", () => {
    const result = deterministicGroup([], "2026-04-10");
    expect(result.date).toBe("2026-04-10");
  });

  it("empty commits → empty groups", () => {
    const result = deterministicGroup([], "2026-04-10");
    expect(result.groups).toHaveLength(0);
  });

  it("single commit → one group with one item", () => {
    const commits = [makeClassified({ hash: "aaa", module: "auth", summary: "add OAuth" })];
    const result = deterministicGroup(commits, "2026-04-10");
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]!.module).toBe("auth");
    expect(result.groups[0]!.items).toHaveLength(1);
    expect(result.groups[0]!.items[0]!.summary).toBe("add OAuth");
    expect(result.groups[0]!.items[0]!.hashes).toEqual(["aaa"]);
  });

  it("commits in the same module → one group", () => {
    const commits = [
      makeClassified({ hash: "aaa", module: "auth", summary: "add OAuth" }),
      makeClassified({ hash: "bbb", module: "auth", summary: "fix token refresh" }),
    ];
    const result = deterministicGroup(commits, "2026-04-10");
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]!.items).toHaveLength(2);
  });

  it("commits in different modules → separate groups", () => {
    const commits = [
      makeClassified({ hash: "aaa", module: "auth" }),
      makeClassified({ hash: "bbb", module: "ui" }),
      makeClassified({ hash: "ccc", module: "api" }),
    ];
    const result = deterministicGroup(commits, "2026-04-10");
    const modules = result.groups.map((g) => g.module);
    expect(modules).toContain("auth");
    expect(modules).toContain("ui");
    expect(modules).toContain("api");
    expect(result.groups).toHaveLength(3);
  });

  it("group type is taken from the first commit in the module", () => {
    const commits = [
      makeClassified({ hash: "aaa", module: "api", type: "fix" }),
      makeClassified({ hash: "bbb", module: "api", type: "feat" }),
    ];
    const result = deterministicGroup(commits, "2026-04-10");
    expect(result.groups[0]!.type).toBe("fix");
  });

  it("each item wraps its hash in an array", () => {
    const commits = [makeClassified({ hash: "deadbeef", module: "core" })];
    const result = deterministicGroup(commits, "2026-04-10");
    expect(result.groups[0]!.items[0]!.hashes).toEqual(["deadbeef"]);
  });
});
