/*
<MODULE_CONTRACT>
  <purpose>RFC-0840: Unit tests for operator config file persistence and restoration.</purpose>
  <keywords>RFC-0840, operator-config-files, persist, restore, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0840: initial unit tests for persistOperatorConfigFiles and restoreOperatorConfigFiles.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  persistOperatorConfigFiles,
  restoreOperatorConfigFiles,
  OPERATOR_CONFIG_FILES,
} from "./operator-config-files.ts";

let tmpDir: string;
let workpieceDir: string;
let cacheCloneDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "test-operator-config-"));
  workpieceDir = path.join(tmpDir, "workpiece");
  cacheCloneDir = path.join(tmpDir, "cache-clone");
  await fs.mkdir(workpieceDir, { recursive: true });
  await fs.mkdir(cacheCloneDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("persistOperatorConfigFiles copies root-level and src-level files to cache clone", async () => {
  await fs.writeFile(
    path.join(workpieceDir, ".lighthouse-budget-ignore"),
    "orphan.js\nunused.css\n",
    "utf8",
  );
  await fs.mkdir(path.join(workpieceDir, "src"), { recursive: true });
  await fs.writeFile(
    path.join(workpieceDir, "src", "image-delivery.config.yaml"),
    "rules: []\n",
    "utf8",
  );

  const result = await persistOperatorConfigFiles(workpieceDir, cacheCloneDir);

  expect(result.copied).toContain(".lighthouse-budget-ignore");
  expect(result.copied).toContain("src/image-delivery.config.yaml");
  expect(result.skipped).toHaveLength(0);
  expect(existsSync(path.join(cacheCloneDir, ".lighthouse-budget-ignore"))).toBe(true);
  expect(existsSync(path.join(cacheCloneDir, "src", "image-delivery.config.yaml"))).toBe(true);
  expect(
    await fs.readFile(path.join(cacheCloneDir, ".lighthouse-budget-ignore"), "utf8"),
  ).toBe("orphan.js\nunused.css\n");
});

test("persistOperatorConfigFiles silently skips missing files", async () => {
  const result = await persistOperatorConfigFiles(workpieceDir, cacheCloneDir);
  expect(result.copied).toHaveLength(0);
  expect(result.skipped).toHaveLength(0);
});

test("restoreOperatorConfigFiles copies files from cache clone to workpiece at correct paths", async () => {
  await fs.writeFile(
    path.join(cacheCloneDir, ".lighthouse-budget-ignore"),
    "ignore-pattern\n",
    "utf8",
  );
  await fs.mkdir(path.join(cacheCloneDir, "src"), { recursive: true });
  await fs.writeFile(
    path.join(cacheCloneDir, "src", "image-delivery.config.yaml"),
    "rules: [{ id: img1 }]\n",
    "utf8",
  );

  const result = await restoreOperatorConfigFiles(cacheCloneDir, workpieceDir);

  expect(result.copied).toContain(".lighthouse-budget-ignore");
  expect(result.copied).toContain("src/image-delivery.config.yaml");
  expect(result.skipped).toHaveLength(0);
  expect(existsSync(path.join(workpieceDir, ".lighthouse-budget-ignore"))).toBe(true);
  expect(existsSync(path.join(workpieceDir, "src", "image-delivery.config.yaml"))).toBe(true);
});

test("restoreOperatorConfigFiles creates parent directories if they do not exist", async () => {
  await fs.mkdir(path.join(cacheCloneDir, "src"), { recursive: true });
  await fs.writeFile(
    path.join(cacheCloneDir, "src", "image-delivery.config.yaml"),
    "rules: []\n",
    "utf8",
  );

  expect(existsSync(path.join(workpieceDir, "src"))).toBe(false);

  const result = await restoreOperatorConfigFiles(cacheCloneDir, workpieceDir);

  expect(result.copied).toContain("src/image-delivery.config.yaml");
  expect(existsSync(path.join(workpieceDir, "src", "image-delivery.config.yaml"))).toBe(true);
});

test("restoreOperatorConfigFiles silently skips missing files in cache clone", async () => {
  const result = await restoreOperatorConfigFiles(cacheCloneDir, workpieceDir);
  expect(result.copied).toHaveLength(0);
  expect(result.skipped).toHaveLength(0);
});

test("restoreOperatorConfigFiles does NOT modify file contents", async () => {
  const originalContent = "PUBLIC_IMAGE_PROVIDER=cloudflare\nrules: []\n";
  await fs.writeFile(
    path.join(cacheCloneDir, ".lighthouse-budget-ignore"),
    originalContent,
    "utf8",
  );

  await restoreOperatorConfigFiles(cacheCloneDir, workpieceDir);

  const restored = await fs.readFile(
    path.join(workpieceDir, ".lighthouse-budget-ignore"),
    "utf8",
  );
  expect(restored).toBe(originalContent);
});

test("OPERATOR_CONFIG_FILES contains expected path-based entries", () => {
  expect(OPERATOR_CONFIG_FILES).toContain(".lighthouse-budget-ignore");
  expect(OPERATOR_CONFIG_FILES).toContain("src/image-delivery.config.yaml");
  expect(OPERATOR_CONFIG_FILES).not.toContain("dns-records.yaml");
  expect(OPERATOR_CONFIG_FILES).not.toContain("live-video-manifest.generated.yaml");
});
