/*
<MODULE_CONTRACT>
  <purpose>RFC-0840: Unit tests for materialize.config.validate command handler.</purpose>
  <keywords>RFC-0840, materialize-config-validate, MAT-CONFIG-01, MAT-CONFIG-02, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0840: initial unit tests for runMaterializeConfigValidate.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

vi.mock("../sternsystem/registry-io.ts", () => ({
  resolveCacheClonePath: vi.fn(),
  discoverSystems: vi.fn(),
}));

import { runMaterializeConfigValidate } from "./materialize-config-validate.ts";
import { resolveCacheClonePath, discoverSystems } from "../sternsystem/registry-io.ts";

const mockResolveCacheClonePath = vi.mocked(resolveCacheClonePath);
const mockDiscoverSystems = vi.mocked(discoverSystems);

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "test-mat-config-validate-"));
  mockResolveCacheClonePath.mockReset();
  mockDiscoverSystems.mockReset();
  mockDiscoverSystems.mockResolvedValue({ systems: [] } as never);
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function makeContext(workspaceRoot: string) {
  return {
    workspaceRoot,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    io: {
      readFile: fs.readFile,
      writeFile: fs.writeFile,
      readdir: fs.readdir,
      mkdir: fs.mkdir,
      rm: fs.rm,
      stat: fs.stat,
    },
  } as never;
}

test("MAT-CONFIG-01: unrecognized root-level file in workpiece emits warning", async () => {
  const missionsDir = path.join(tmpDir, "missions", "m001", "workpiece");
  await fs.mkdir(missionsDir, { recursive: true });
  await fs.writeFile(path.join(missionsDir, "mystery-config.yaml"), "foo: bar\n", "utf8");
  await fs.writeFile(path.join(missionsDir, ".lighthouse-budget-ignore"), "pattern\n", "utf8");
  const srcDir = path.join(missionsDir, "src");
  await fs.mkdir(srcDir, { recursive: true });
  await fs.writeFile(path.join(srcDir, "image-delivery.config.yaml"), "rules: []\n", "utf8");

  const result = await runMaterializeConfigValidate(
    { flags: {}, args: [] } as never,
    makeContext(tmpDir),
  );

  const warnings = result.data!.diagnostics.filter((d) => d.ruleId === "MAT-CONFIG-01");
  expect(warnings.length).toBeGreaterThanOrEqual(1);
  expect(warnings.some((w) => w.message.includes("mystery-config.yaml"))).toBe(true);
  expect(result.data!.status).toBe("warn");
});

test("MAT-CONFIG-01: unrecognized file in src/ emits warning", async () => {
  const srcDir = path.join(tmpDir, "missions", "m001", "workpiece", "src");
  await fs.mkdir(srcDir, { recursive: true });
  await fs.writeFile(path.join(srcDir, "custom-operator.yaml"), "foo: bar\n", "utf8");

  const result = await runMaterializeConfigValidate(
    { flags: {}, args: [] } as never,
    makeContext(tmpDir),
  );

  const warnings = result.data!.diagnostics.filter((d) => d.ruleId === "MAT-CONFIG-01");
  expect(warnings.some((w) => w.message.includes("src/custom-operator.yaml"))).toBe(true);
});

test("MAT-CONFIG-01: generated files and boilerplate do NOT emit warnings", async () => {
  const wpDir = path.join(tmpDir, "missions", "m001", "workpiece");
  const srcDir = path.join(wpDir, "src");
  await fs.mkdir(srcDir, { recursive: true });
  await fs.writeFile(path.join(wpDir, "package.json"), "{}\n", "utf8");
  await fs.writeFile(path.join(wpDir, ".gitignore"), "node_modules\n", "utf8");
  await fs.writeFile(path.join(srcDir, "content-ref-index.generated.yaml"), "[]\n", "utf8");
  await fs.writeFile(path.join(srcDir, "system.md"), "---\n---\n", "utf8");

  const result = await runMaterializeConfigValidate(
    { flags: {}, args: [] } as never,
    makeContext(tmpDir),
  );

  const warnings = result.data!.diagnostics.filter((d) => d.ruleId === "MAT-CONFIG-01");
  expect(warnings).toHaveLength(0);
});

test("MAT-CONFIG-02: dead entry in OPERATOR_CONFIG_FILES emits error", async () => {
  mockDiscoverSystems.mockResolvedValue({ systems: [] } as never);

  const result = await runMaterializeConfigValidate(
    { flags: {}, args: [] } as never,
    makeContext(tmpDir),
  );

  const errors = result.data!.diagnostics.filter((d) => d.ruleId === "MAT-CONFIG-02");
  expect(errors.length).toBe(OPERATOR_CONFIG_FILES.length);
  expect(result.data!.status).toBe("fail");
  expect(result.exitCode).toBe(1);
});

test("MAT-CONFIG-02: entry found in workpiece does NOT emit error", async () => {
  const wpDir = path.join(tmpDir, "missions", "m001", "workpiece");
  await fs.mkdir(wpDir, { recursive: true });
  await fs.writeFile(path.join(wpDir, ".lighthouse-budget-ignore"), "pattern\n", "utf8");

  const srcDir = path.join(wpDir, "src");
  await fs.mkdir(srcDir, { recursive: true });
  await fs.writeFile(path.join(srcDir, "image-delivery.config.yaml"), "rules: []\n", "utf8");

  const result = await runMaterializeConfigValidate(
    { flags: {}, args: [] } as never,
    makeContext(tmpDir),
  );

  const errors = result.data!.diagnostics.filter((d) => d.ruleId === "MAT-CONFIG-02");
  expect(errors).toHaveLength(0);
});

test("MAT-CONFIG-01: env.d.ts, middleware.ts, and *.generated.mjs do NOT emit warnings", async () => {
  const wpDir = path.join(tmpDir, "missions", "m001", "workpiece");
  const srcDir = path.join(wpDir, "src");
  await fs.mkdir(srcDir, { recursive: true });
  await fs.writeFile(
    path.join(srcDir, "env.d.ts"),
    '/// <reference types="astro/client" />\n',
    "utf8",
  );
  await fs.writeFile(path.join(srcDir, "middleware.ts"), "export default {};\n", "utf8");
  await fs.writeFile(path.join(srcDir, "env.schema.generated.mjs"), "export {};\n", "utf8");

  const result = await runMaterializeConfigValidate(
    { flags: {}, args: [] } as never,
    makeContext(tmpDir),
  );

  const warnings = result.data!.diagnostics.filter((d) => d.ruleId === "MAT-CONFIG-01");
  expect(warnings).toHaveLength(0);
});

test("clean case: all files recognized, no warnings or errors", async () => {
  const wpDir = path.join(tmpDir, "missions", "m001", "workpiece");
  await fs.mkdir(wpDir, { recursive: true });
  await fs.writeFile(path.join(wpDir, ".lighthouse-budget-ignore"), "pattern\n", "utf8");
  await fs.writeFile(path.join(wpDir, "package.json"), "{}\n", "utf8");

  const srcDir = path.join(wpDir, "src");
  await fs.mkdir(srcDir, { recursive: true });
  await fs.writeFile(path.join(srcDir, "image-delivery.config.yaml"), "rules: []\n", "utf8");
  await fs.writeFile(path.join(srcDir, "system.md"), "---\n---\n", "utf8");

  const result = await runMaterializeConfigValidate(
    { flags: {}, args: [] } as never,
    makeContext(tmpDir),
  );

  expect(result.data!.diagnostics).toHaveLength(0);
  expect(result.data!.status).toBe("pass");
  expect(result.exitCode).toBe(0);
});

const { OPERATOR_CONFIG_FILES } = await import("./operator-config-files.ts");
