import { test, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanDirectoryForImports } from "../plugin/import-scan-util.ts";

function makeTmpDir() {
  return mkdtempSync(join(tmpdir(), "import-scan-"));
}

test("scanDirectoryForImports finds matching import specifiers", async () => {
  const dir = makeTmpDir();
  writeFileSync(
    join(dir, "a.ts"),
    `import { foo } from "@warpgogol/forge";\nimport type { Bar } from "@warpgogol/werkstatt-engine/kernel";\n`,
  );
  const result = await scanDirectoryForImports(dir, dir, (s) => s.startsWith("@warpgogol/"));
  expect(result.scannedFiles).toBe(1);
  expect(result.violations).toHaveLength(2);
  expect(result.violations[0]!.specifier).toBe("@warpgogol/forge");
  expect(result.violations[1]!.specifier).toBe("@warpgogol/werkstatt-engine/kernel");
});

test("scanDirectoryForImports finds require() calls at line start", async () => {
  const dir = makeTmpDir();
  writeFileSync(join(dir, "a.ts"), `require("@warpgogol/forge");\n`);
  const result = await scanDirectoryForImports(dir, dir, (s) => s.startsWith("@warpgogol/"));
  expect(result.violations).toHaveLength(1);
  expect(result.violations[0]!.specifier).toBe("@warpgogol/forge");
});

test("scanDirectoryForImports excludes .test.ts files", async () => {
  const dir = makeTmpDir();
  writeFileSync(join(dir, "a.ts"), `import { foo } from "@warpgogol/forge";\n`);
  writeFileSync(join(dir, "a.test.ts"), `import { bar } from "@warpgogol/forge";\n`);
  const result = await scanDirectoryForImports(dir, dir, (s) => s.startsWith("@warpgogol/"));
  expect(result.scannedFiles).toBe(1);
  expect(result.violations).toHaveLength(1);
  expect(result.violations[0]!.file).toBe("a.ts");
});

test("scanDirectoryForImports excludes .spec.ts files", async () => {
  const dir = makeTmpDir();
  writeFileSync(join(dir, "a.spec.ts"), `import { bar } from "@warpgogol/forge";\n`);
  const result = await scanDirectoryForImports(dir, dir, (s) => s.startsWith("@warpgogol/"));
  expect(result.scannedFiles).toBe(0);
  expect(result.violations).toHaveLength(0);
});

test("scanDirectoryForImports excludes node_modules, tests, tests-handoff, dist, templates dirs", async () => {
  const dir = makeTmpDir();
  for (const excluded of ["node_modules", "tests", "tests-handoff", "dist", "templates"]) {
    mkdirSync(join(dir, excluded));
    writeFileSync(join(dir, excluded, "a.ts"), `import { x } from "@warpgogol/forge";\n`);
  }
  const result = await scanDirectoryForImports(dir, dir, (s) => s.startsWith("@warpgogol/"));
  expect(result.scannedFiles).toBe(0);
  expect(result.violations).toHaveLength(0);
});

test("scanDirectoryForImports recurses into subdirectories", async () => {
  const dir = makeTmpDir();
  mkdirSync(join(dir, "sub"));
  writeFileSync(join(dir, "a.ts"), `import { foo } from "@warpgogol/forge";\n`);
  writeFileSync(join(dir, "sub", "b.ts"), `import { bar } from "@warpgogol/werkstatt-site";\n`);
  const result = await scanDirectoryForImports(dir, dir, (s) => s.startsWith("@warpgogol/"));
  expect(result.scannedFiles).toBe(2);
  expect(result.violations).toHaveLength(2);
});

test("scanDirectoryForImports reports relative file paths", async () => {
  const dir = makeTmpDir();
  mkdirSync(join(dir, "sub"));
  writeFileSync(join(dir, "sub", "a.ts"), `import { foo } from "@warpgogol/forge";\n`);
  const result = await scanDirectoryForImports(dir, dir, (s) => s.startsWith("@warpgogol/"));
  expect(result.violations[0]!.file).toBe(join("sub", "a.ts"));
});

test("scanDirectoryForImports returns empty for no matches", async () => {
  const dir = makeTmpDir();
  writeFileSync(join(dir, "a.ts"), `import { foo } from "zod";\n`);
  const result = await scanDirectoryForImports(dir, dir, (s) => s.startsWith("@warpgogol/"));
  expect(result.scannedFiles).toBe(1);
  expect(result.violations).toHaveLength(0);
});

test("scanDirectoryForImports handles import type statements", async () => {
  const dir = makeTmpDir();
  writeFileSync(join(dir, "a.ts"), `import type { Foo } from "@warpgogol/forge";\n`);
  const result = await scanDirectoryForImports(dir, dir, (s) => s.startsWith("@warpgogol/"));
  expect(result.violations).toHaveLength(1);
  expect(result.violations[0]!.specifier).toBe("@warpgogol/forge");
});

test("scanDirectoryForImports handles non-existent directory gracefully", async () => {
  const result = await scanDirectoryForImports(
    join(tmpdir(), "nonexistent-dir-xyz"),
    tmpdir(),
    () => true,
  );
  expect(result.scannedFiles).toBe(0);
  expect(result.violations).toHaveLength(0);
});

test("scanDirectoryForImports handles multiple imports per file", async () => {
  const dir = makeTmpDir();
  writeFileSync(
    join(dir, "a.ts"),
    `import { a } from "@warpgogol/forge";\nimport { b } from "@warpgogol/werkstatt-site";\nimport { c } from "zod";\n`,
  );
  const result = await scanDirectoryForImports(dir, dir, (s) => s.startsWith("@warpgogol/"));
  expect(result.violations).toHaveLength(2);
});
