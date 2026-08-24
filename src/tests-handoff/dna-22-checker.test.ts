/*
<MODULE_CONTRACT>
<purpose>RFC-0555: tests for DNA-22 path validation checker (isClientEditable).</purpose>
<keywords>RFC-0555, DNA-22, clientEditable, workpiece, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0555: initial unit tests for isClientEditable.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isClientEditable } from "../workpiece/dna-22-checker.ts";
import { tmpdir } from "node:os";

let tmpDir: string;

function setupWorkpiece(clientEditable: string[]): string {
  tmpDir = mkdtempSync(join(tmpdir(), "tmp-dna22-test-"));
  const contentDir = join(tmpDir, "src", "content");
  mkdirSync(contentDir, { recursive: true });
  mkdirSync(join(contentDir, "pages"), { recursive: true });
  mkdirSync(join(contentDir, "prose"), { recursive: true });
  mkdirSync(join(contentDir, "assets"), { recursive: true });

  const frontmatter = `---\napp: test-app\nversion: 1.0.0\nidentity:\n  systemStar: test\n  biome: default\n  tagline: test\nconstellations:\n  - test\nclientEditable:\n${clientEditable.map((e) => `  - ${e}`).join("\n")}\npages: []\ngrowth:\n  vendor:\n    adapter: null\n    options: {}\n  funnels: []\n  experiments: []\nrelease:\n  passport:\n    enabled: false\n    indexable: false\n    keyVersion: "1"\n    heartbeatUrl: ""\n---\n\n# Test\n`;
  writeFileSync(join(contentDir, "system.md"), frontmatter);
  writeFileSync(join(contentDir, "pages", "home.md"), "# Home");
  writeFileSync(join(contentDir, "prose", "about.md"), "# About");
  return tmpDir;
}

beforeEach(() => {
  setupWorkpiece(["pages", "prose"]);
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

test("isClientEditable returns true for path inside clientEditable entry", async () => {
  const result = await isClientEditable(tmpDir, "src/content/pages/home.md");
  expect(result).toBe(true);
});

test("isClientEditable returns true for path matching clientEditable entry exactly", async () => {
  const result = await isClientEditable(tmpDir, "src/content/pages");
  expect(result).toBe(true);
});

test("isClientEditable returns false for path outside clientEditable entries", async () => {
  const result = await isClientEditable(tmpDir, "src/content/system.md");
  expect(result).toBe(false);
});

test("isClientEditable returns false for path outside src/content", async () => {
  const result = await isClientEditable(tmpDir, "packages/studio-gate/src/index.ts");
  expect(result).toBe(false);
});

test("isClientEditable returns false for path traversal attempt", async () => {
  const result = await isClientEditable(tmpDir, "../../packages/studio-gate/src/index.ts");
  expect(result).toBe(false);
});

test("isClientEditable returns true for *.client.ts under src/content", async () => {
  const contentDir = join(tmpDir, "src", "content");
  writeFileSync(join(contentDir, "feature.client.ts"), "// client script");
  const result = await isClientEditable(tmpDir, "src/content/feature.client.ts");
  expect(result).toBe(true);
});

test("isClientEditable returns true for assets directory under src/content", async () => {
  const contentDir = join(tmpDir, "src", "content");
  mkdirSync(join(contentDir, "assets"), { recursive: true });
  writeFileSync(join(contentDir, "assets", "logo.png"), "fake-png");
  const result = await isClientEditable(tmpDir, "src/content/assets/logo.png");
  expect(result).toBe(true);
});
