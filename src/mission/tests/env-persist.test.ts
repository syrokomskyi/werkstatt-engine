/*
<MODULE_CONTRACT>
<purpose>
Unit tests for env persist covering collectEnvFiles; persistEnvFilesToCacheClone; restoreEnvFilesFromCacheClone. It also guards the documented public contract and regression-sensitive edge cases.
</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1311: Compass header sweep — declares the env suite's contract for test-file scaffold coverage.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, describe, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  collectEnvFiles,
  persistEnvFilesToCacheClone,
  restoreEnvFilesFromCacheClone,
} from "../env-persist.ts";

let workpieceDir: string;
let cacheCloneDir: string;

beforeEach(() => {
  workpieceDir = mkdtempSync(join(process.cwd(), "tmp-env-workpiece-"));
  cacheCloneDir = mkdtempSync(join(process.cwd(), "tmp-env-cache-"));
});

afterEach(() => {
  rmSync(workpieceDir, { recursive: true, force: true });
  rmSync(cacheCloneDir, { recursive: true, force: true });
});

describe("collectEnvFiles", () => {
  test("returns empty array when dir does not exist", async () => {
    expect(await collectEnvFiles("/nonexistent/path")).toEqual([]);
  });

  test("collects .env files", async () => {
    writeFileSync(join(workpieceDir, ".env"), "KEY=value\n");
    writeFileSync(join(workpieceDir, ".env.production"), "KEY2=value2\n");
    const files = await collectEnvFiles(workpieceDir);
    expect(files).toContain(".env");
    expect(files).toContain(".env.production");
  });

  test("excludes .env.example", async () => {
    writeFileSync(join(workpieceDir, ".env"), "KEY=value\n");
    writeFileSync(join(workpieceDir, ".env.example"), "KEY=value\n");
    const files = await collectEnvFiles(workpieceDir);
    expect(files).toContain(".env");
    expect(files).not.toContain(".env.example");
  });

  test("excludes .env.*.example pattern", async () => {
    writeFileSync(join(workpieceDir, ".env"), "KEY=value\n");
    writeFileSync(join(workpieceDir, ".env.production.example"), "KEY=value\n");
    const files = await collectEnvFiles(workpieceDir);
    expect(files).toContain(".env");
    expect(files).not.toContain(".env.production.example");
  });
});

describe("persistEnvFilesToCacheClone", () => {
  test("copies .env files from workpiece to cache clone", async () => {
    writeFileSync(join(workpieceDir, ".env"), "KEY=value\n");
    const result = await persistEnvFilesToCacheClone(workpieceDir, cacheCloneDir);
    expect(result.copied).toContain(".env");
    expect(result.skipped).toEqual([]);
    const content = readFileSync(join(cacheCloneDir, ".env"), "utf8");
    expect(content).toBe("KEY=value\n");
  });

  test("returns empty copied when no .env files exist", async () => {
    const result = await persistEnvFilesToCacheClone(workpieceDir, cacheCloneDir);
    expect(result.copied).toEqual([]);
  });
});

describe("restoreEnvFilesFromCacheClone", () => {
  test("copies .env files from cache clone to workpiece", async () => {
    writeFileSync(join(cacheCloneDir, ".env"), "KEY=value\n");
    const result = await restoreEnvFilesFromCacheClone(cacheCloneDir, workpieceDir);
    expect(result.copied).toContain(".env");
    const content = readFileSync(join(workpieceDir, ".env"), "utf8");
    expect(content).toBe("KEY=value\n");
  });

  test("replaces PUBLIC_IMAGE_PROVIDER with build-portable", async () => {
    writeFileSync(join(cacheCloneDir, ".env"), "PUBLIC_IMAGE_PROVIDER=astro\nOTHER=value\n");
    await restoreEnvFilesFromCacheClone(cacheCloneDir, workpieceDir);
    const content = readFileSync(join(workpieceDir, ".env"), "utf8");
    expect(content).toContain("PUBLIC_IMAGE_PROVIDER=build-portable");
    expect(content).not.toContain("PUBLIC_IMAGE_PROVIDER=astro");
    expect(content).toContain("OTHER=value");
  });

  test("returns empty copied when no .env files exist", async () => {
    const result = await restoreEnvFilesFromCacheClone(cacheCloneDir, workpieceDir);
    expect(result.copied).toEqual([]);
  });
});
