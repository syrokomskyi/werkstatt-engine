/*
<MODULE_CONTRACT>
<purpose>RFC-0822: Unit tests for env-persist module — persist/restore .env* files between workpiece and cache clone.</purpose>
<non-goals>
  <item>Do not test mission.close or mission.materialize integration — those are covered by their own test suites.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0822: initial env-persist unit tests.</item>
</CHANGE_SUMMARY>
*/

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  persistEnvFilesToCacheClone,
  restoreEnvFilesFromCacheClone,
} from "../mission/env-persist.ts";

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "env-persist-test-"));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("persistEnvFilesToCacheClone", () => {
  it("copies .env and .env.dev from workpiece to cache clone", async () => {
    const workpieceDir = path.join(tempDir, "workpiece");
    const cacheCloneDir = path.join(tempDir, "cache");
    await fs.mkdir(workpieceDir, { recursive: true });
    await fs.mkdir(cacheCloneDir, { recursive: true });
    await fs.writeFile(path.join(workpieceDir, ".env"), "SECRET=abc123\n");
    await fs.writeFile(path.join(workpieceDir, ".env.dev"), "DEV_SECRET=def456\n");

    const result = await persistEnvFilesToCacheClone(workpieceDir, cacheCloneDir);

    expect(result.copied).toContain(".env");
    expect(result.copied).toContain(".env.dev");
    expect(result.copied).toHaveLength(2);
    expect(result.skipped).toHaveLength(0);
    expect(await fs.readFile(path.join(cacheCloneDir, ".env"), "utf8")).toBe("SECRET=abc123\n");
    expect(await fs.readFile(path.join(cacheCloneDir, ".env.dev"), "utf8")).toBe(
      "DEV_SECRET=def456\n",
    );
  });

  it("excludes .env.example and .env.*.example files", async () => {
    const workpieceDir = path.join(tempDir, "workpiece");
    const cacheCloneDir = path.join(tempDir, "cache");
    await fs.mkdir(workpieceDir, { recursive: true });
    await fs.mkdir(cacheCloneDir, { recursive: true });
    await fs.writeFile(path.join(workpieceDir, ".env"), "SECRET=abc123\n");
    await fs.writeFile(path.join(workpieceDir, ".env.example"), "SECRET=\n");
    await fs.writeFile(path.join(workpieceDir, ".env.dev.example"), "DEV_SECRET=\n");

    const result = await persistEnvFilesToCacheClone(workpieceDir, cacheCloneDir);

    expect(result.copied).toEqual([".env"]);
    expect(existsSync(path.join(cacheCloneDir, ".env.example"))).toBe(false);
    expect(existsSync(path.join(cacheCloneDir, ".env.dev.example"))).toBe(false);
  });

  it("overwrites existing files in cache clone", async () => {
    const workpieceDir = path.join(tempDir, "workpiece");
    const cacheCloneDir = path.join(tempDir, "cache");
    await fs.mkdir(workpieceDir, { recursive: true });
    await fs.mkdir(cacheCloneDir, { recursive: true });
    await fs.writeFile(path.join(cacheCloneDir, ".env"), "OLD=old_value\n");
    await fs.writeFile(path.join(workpieceDir, ".env"), "NEW=new_value\n");

    const result = await persistEnvFilesToCacheClone(workpieceDir, cacheCloneDir);

    expect(result.copied).toEqual([".env"]);
    expect(await fs.readFile(path.join(cacheCloneDir, ".env"), "utf8")).toBe("NEW=new_value\n");
  });

  it("returns empty copied array when workpiece has no .env files", async () => {
    const workpieceDir = path.join(tempDir, "workpiece");
    const cacheCloneDir = path.join(tempDir, "cache");
    await fs.mkdir(workpieceDir, { recursive: true });
    await fs.mkdir(cacheCloneDir, { recursive: true });

    const result = await persistEnvFilesToCacheClone(workpieceDir, cacheCloneDir);

    expect(result.copied).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
  });

  it("returns empty arrays when workpiece dir does not exist", async () => {
    const workpieceDir = path.join(tempDir, "nonexistent");
    const cacheCloneDir = path.join(tempDir, "cache");
    await fs.mkdir(cacheCloneDir, { recursive: true });

    const result = await persistEnvFilesToCacheClone(workpieceDir, cacheCloneDir);

    expect(result.copied).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
  });
});

describe("restoreEnvFilesFromCacheClone", () => {
  it("restores .env and .env.dev from cache clone to workpiece", async () => {
    const cacheCloneDir = path.join(tempDir, "cache");
    const workpieceDir = path.join(tempDir, "workpiece");
    await fs.mkdir(cacheCloneDir, { recursive: true });
    await fs.mkdir(workpieceDir, { recursive: true });
    await fs.writeFile(path.join(cacheCloneDir, ".env"), "SECRET=abc123\n");
    await fs.writeFile(path.join(cacheCloneDir, ".env.dev"), "DEV_SECRET=def456\n");

    const result = await restoreEnvFilesFromCacheClone(cacheCloneDir, workpieceDir);

    expect(result.copied).toContain(".env");
    expect(result.copied).toContain(".env.dev");
    expect(result.copied).toHaveLength(2);
    expect(await fs.readFile(path.join(workpieceDir, ".env"), "utf8")).toBe("SECRET=abc123\n");
    expect(await fs.readFile(path.join(workpieceDir, ".env.dev"), "utf8")).toBe(
      "DEV_SECRET=def456\n",
    );
  });

  it("replaces PUBLIC_IMAGE_PROVIDER with build-portable", async () => {
    const cacheCloneDir = path.join(tempDir, "cache");
    const workpieceDir = path.join(tempDir, "workpiece");
    await fs.mkdir(cacheCloneDir, { recursive: true });
    await fs.mkdir(workpieceDir, { recursive: true });
    await fs.writeFile(
      path.join(cacheCloneDir, ".env"),
      "PUBLIC_IMAGE_PROVIDER=astro\nSECRET=abc123\n",
    );

    const result = await restoreEnvFilesFromCacheClone(cacheCloneDir, workpieceDir);

    expect(result.copied).toEqual([".env"]);
    const restored = await fs.readFile(path.join(workpieceDir, ".env"), "utf8");
    expect(restored).toContain("PUBLIC_IMAGE_PROVIDER=build-portable");
    expect(restored).not.toContain("PUBLIC_IMAGE_PROVIDER=astro");
    expect(restored).toContain("SECRET=abc123");
  });

  it("excludes .env.example and .env.*.example files", async () => {
    const cacheCloneDir = path.join(tempDir, "cache");
    const workpieceDir = path.join(tempDir, "workpiece");
    await fs.mkdir(cacheCloneDir, { recursive: true });
    await fs.mkdir(workpieceDir, { recursive: true });
    await fs.writeFile(path.join(cacheCloneDir, ".env"), "SECRET=abc123\n");
    await fs.writeFile(path.join(cacheCloneDir, ".env.example"), "SECRET=\n");
    await fs.writeFile(path.join(cacheCloneDir, ".env.dev.example"), "DEV_SECRET=\n");

    const result = await restoreEnvFilesFromCacheClone(cacheCloneDir, workpieceDir);

    expect(result.copied).toEqual([".env"]);
    expect(existsSync(path.join(workpieceDir, ".env.example"))).toBe(false);
    expect(existsSync(path.join(workpieceDir, ".env.dev.example"))).toBe(false);
  });

  it("returns empty copied array when cache clone has no .env files", async () => {
    const cacheCloneDir = path.join(tempDir, "cache");
    const workpieceDir = path.join(tempDir, "workpiece");
    await fs.mkdir(cacheCloneDir, { recursive: true });
    await fs.mkdir(workpieceDir, { recursive: true });

    const result = await restoreEnvFilesFromCacheClone(cacheCloneDir, workpieceDir);

    expect(result.copied).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
  });

  it("returns empty arrays when cache clone dir does not exist", async () => {
    const cacheCloneDir = path.join(tempDir, "nonexistent");
    const workpieceDir = path.join(tempDir, "workpiece");
    await fs.mkdir(workpieceDir, { recursive: true });

    const result = await restoreEnvFilesFromCacheClone(cacheCloneDir, workpieceDir);

    expect(result.copied).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
  });
});
