/*
<MODULE_CONTRACT>
<purpose>
Unit tests for autonomy validate covering its documented public contract and regression-sensitive edge cases.
</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1311: Compass header sweep — declares the autonomy suite's contract for test-file scaffold coverage.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runAutonomyValidate } from "../plugin/autonomy-validate.ts";

function makeTmpDir() {
  return mkdtempSync(join(tmpdir(), "autonomy-"));
}

function makeWorkspace(tmpDir: string) {
  const engineSrc = join(tmpDir, "packages", "werkstatt-engine", "src");
  mkdirSync(engineSrc, { recursive: true });
  return engineSrc;
}

test("runAutonomyValidate passes when no @warpgogol/* imports exist", async () => {
  const tmpDir = makeTmpDir();
  const engineSrc = makeWorkspace(tmpDir);
  writeFileSync(join(engineSrc, "a.ts"), `import { foo } from "zod";\n`);

  const result = await runAutonomyValidate(tmpDir);
  expect(result.status).toBe("pass");
  expect(result.violations).toHaveLength(0);
  expect(result.scannedFiles).toBe(1);
});

test("runAutonomyValidate passes for self-imports (@warpgogol/werkstatt-engine)", async () => {
  const tmpDir = makeTmpDir();
  const engineSrc = makeWorkspace(tmpDir);
  writeFileSync(
    join(engineSrc, "a.ts"),
    `import { foo } from "@warpgogol/werkstatt-engine/kernel";\n`,
  );

  const result = await runAutonomyValidate(tmpDir);
  expect(result.status).toBe("pass");
  expect(result.violations).toHaveLength(0);
});

test("runAutonomyValidate passes for @warpgogol/werkstatt-shared imports", async () => {
  const tmpDir = makeTmpDir();
  const engineSrc = makeWorkspace(tmpDir);
  writeFileSync(
    join(engineSrc, "a.ts"),
    `import { foo } from "@warpgogol/werkstatt-shared/semantic";\n`,
  );

  const result = await runAutonomyValidate(tmpDir);
  expect(result.status).toBe("pass");
  expect(result.violations).toHaveLength(0);
});

test("runAutonomyValidate passes for @warpgogol/forge imports", async () => {
  const tmpDir = makeTmpDir();
  const engineSrc = makeWorkspace(tmpDir);
  writeFileSync(join(engineSrc, "a.ts"), `import { foo } from "@warpgogol/forge";\n`);

  const result = await runAutonomyValidate(tmpDir);
  expect(result.status).toBe("pass");
  expect(result.violations).toHaveLength(0);
});

test("runAutonomyValidate fails for @warpgogol/werkstatt-site imports", async () => {
  const tmpDir = makeTmpDir();
  const engineSrc = makeWorkspace(tmpDir);
  writeFileSync(
    join(engineSrc, "a.ts"),
    `import { foo } from "@warpgogol/werkstatt-site/checks";\n`,
  );

  const result = await runAutonomyValidate(tmpDir);
  expect(result.status).toBe("fail");
  expect(result.violations).toHaveLength(1);
  expect(result.violations[0]!.specifier).toBe("@warpgogol/werkstatt-site/checks");
});

test("runAutonomyValidate fails for unknown @warpgogol/* imports", async () => {
  const tmpDir = makeTmpDir();
  const engineSrc = makeWorkspace(tmpDir);
  writeFileSync(
    join(engineSrc, "a.ts"),
    `import { foo } from "${"@warpgogol" + "/unknown-pkg"}";\n`,
  );

  const result = await runAutonomyValidate(tmpDir);
  expect(result.status).toBe("fail");
  expect(result.violations).toHaveLength(1);
});

test("runAutonomyValidate excludes test files from scanning", async () => {
  const tmpDir = makeTmpDir();
  const engineSrc = makeWorkspace(tmpDir);
  writeFileSync(join(engineSrc, "a.test.ts"), `import { foo } from "@warpgogol/werkstatt-site";\n`);
  writeFileSync(join(engineSrc, "a.spec.ts"), `import { bar } from "@warpgogol/werkstatt-site";\n`);

  const result = await runAutonomyValidate(tmpDir);
  expect(result.status).toBe("pass");
  expect(result.scannedFiles).toBe(0);
});

test("runAutonomyValidate excludes tests and tests-handoff directories", async () => {
  const tmpDir = makeTmpDir();
  const engineSrc = makeWorkspace(tmpDir);
  mkdirSync(join(engineSrc, "tests"));
  mkdirSync(join(engineSrc, "tests-handoff"));
  writeFileSync(
    join(engineSrc, "tests", "a.ts"),
    `import { foo } from "@warpgogol/werkstatt-site";\n`,
  );
  writeFileSync(
    join(engineSrc, "tests-handoff", "b.ts"),
    `import { bar } from "@warpgogol/werkstatt-site";\n`,
  );

  const result = await runAutonomyValidate(tmpDir);
  expect(result.status).toBe("pass");
});

test("runAutonomyValidate reports relative file paths in violations", async () => {
  const tmpDir = makeTmpDir();
  const engineSrc = makeWorkspace(tmpDir);
  mkdirSync(join(engineSrc, "sub"));
  writeFileSync(
    join(engineSrc, "sub", "a.ts"),
    `import { foo } from "@warpgogol/werkstatt-site";\n`,
  );

  const result = await runAutonomyValidate(tmpDir);
  expect(result.status).toBe("fail");
  expect(result.violations[0]!.file).toContain("a.ts");
  expect(result.violations[0]!.file).toContain("sub");
});

test("runAutonomyValidate command name is correct", async () => {
  const tmpDir = makeTmpDir();
  makeWorkspace(tmpDir);
  const result = await runAutonomyValidate(tmpDir);
  expect(result.command).toBe("werkstatt.autonomy.validate");
});
