import { test, expect, describe, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CACHE_CLONE_GITIGNORE_SENTINEL,
  CACHE_CLONE_GENERATED_PATTERNS,
  CACHE_CLONE_ONLY_PATTERNS,
  restoreCacheCloneGitignore,
} from "../cache-clone-gitignore.ts";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(process.cwd(), "tmp-cache-gitignore-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("CACHE_CLONE_GITIGNORE_SENTINEL", () => {
  test("is a comment string", () => {
    expect(CACHE_CLONE_GITIGNORE_SENTINEL).toContain("CACHE-CLONE-ONLY");
  });
});

describe("CACHE_CLONE_GENERATED_PATTERNS", () => {
  test("is a non-empty array", () => {
    expect(CACHE_CLONE_GENERATED_PATTERNS.length).toBeGreaterThan(0);
  });

  test("includes behavior.snapshot.generated.yaml", () => {
    expect(CACHE_CLONE_GENERATED_PATTERNS).toContain("behavior.snapshot.generated.yaml");
  });
});

describe("CACHE_CLONE_ONLY_PATTERNS", () => {
  test("is a non-empty array", () => {
    expect(CACHE_CLONE_ONLY_PATTERNS.length).toBeGreaterThan(0);
  });

  test("includes all generated patterns", () => {
    for (const p of CACHE_CLONE_GENERATED_PATTERNS) {
      expect(CACHE_CLONE_ONLY_PATTERNS).toContain(p);
    }
  });
});

describe("restoreCacheCloneGitignore", () => {
  test("creates .gitignore when it does not exist", async () => {
    const changed = await restoreCacheCloneGitignore(tmpDir);
    expect(changed).toBe(true);
    const content = readFileSync(join(tmpDir, ".gitignore"), "utf8");
    expect(content).toContain(CACHE_CLONE_GITIGNORE_SENTINEL);
  });

  test("returns false when sentinel already present", async () => {
    writeFileSync(
      join(tmpDir, ".gitignore"),
      `some-rule\n${CACHE_CLONE_GITIGNORE_SENTINEL}\nfoo\n`,
    );
    const changed = await restoreCacheCloneGitignore(tmpDir);
    expect(changed).toBe(false);
  });

  test("appends sentinel and patterns when .gitignore exists without sentinel", async () => {
    writeFileSync(join(tmpDir, ".gitignore"), "existing-rule\n");
    const changed = await restoreCacheCloneGitignore(tmpDir);
    expect(changed).toBe(true);
    const content = readFileSync(join(tmpDir, ".gitignore"), "utf8");
    expect(content).toContain("existing-rule");
    expect(content).toContain(CACHE_CLONE_GITIGNORE_SENTINEL);
  });
});
