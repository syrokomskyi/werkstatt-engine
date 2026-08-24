import { test, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runSharedValidate } from "../plugin/shared-validate.ts";

function makeTmpDir() {
  return mkdtempSync(join(tmpdir(), "shared-validate-"));
}

function makeWorkspace(tmpDir: string) {
  const engineSrc = join(tmpDir, "packages", "werkstatt", "src");
  mkdirSync(engineSrc, { recursive: true });
  return engineSrc;
}

function makePkgJson(tmpDir: string, deps: Record<string, string> = {}) {
  const pkgDir = join(tmpDir, "packages", "werkstatt");
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(
    join(pkgDir, "package.json"),
    JSON.stringify({ name: "@warpgogol/werkstatt-engine", version: "1.0.0", dependencies: deps }),
  );
}

function makeAutonomyFile(tmpDir: string, content: string) {
  const pluginDir = join(tmpDir, "packages", "werkstatt", "src", "plugin");
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(join(pluginDir, "autonomy-validate.ts"), content);
}

const AUTONOMY_CLEAN = `
const EXEMPT_PREFIXES = ["@warpgogol/werkstatt-engine", "@warpgogol/werkstatt-shared", "@warpgogol/forge"];
export function isExempt(specifier: string): boolean { return false; }
`;

const AUTONOMY_WITH_SITE = `
const EXEMPT_PREFIXES = ["@warpgogol/werkstatt-engine", "@warpgogol/werkstatt-site", "@warpgogol/forge"];
export function isExempt(specifier: string): boolean { return false; }
`;

// ---------------------------------------------------------------------------
// SHARED-01: dependency declaration
// ---------------------------------------------------------------------------

test("SHARED-01 passes when @warpgogol/werkstatt-shared is in dependencies", async () => {
  const tmpDir = makeTmpDir();
  makeWorkspace(tmpDir);
  makePkgJson(tmpDir, { "@warpgogol/werkstatt-shared": "*" });
  makeAutonomyFile(tmpDir, AUTONOMY_CLEAN);

  const result = await runSharedValidate(tmpDir);
  const shared01 = result.checks.find((c) => c.id === "SHARED-01");
  expect(shared01?.status).toBe("pass");
});

test("SHARED-01 fails when @warpgogol/werkstatt-shared is missing from dependencies", async () => {
  const tmpDir = makeTmpDir();
  makeWorkspace(tmpDir);
  makePkgJson(tmpDir, {});
  makeAutonomyFile(tmpDir, AUTONOMY_CLEAN);

  const result = await runSharedValidate(tmpDir);
  const shared01 = result.checks.find((c) => c.id === "SHARED-01");
  expect(shared01?.status).toBe("fail");
});

test("SHARED-01 fails when package.json cannot be read", async () => {
  const tmpDir = makeTmpDir();
  makeWorkspace(tmpDir);
  makeAutonomyFile(tmpDir, AUTONOMY_CLEAN);

  const result = await runSharedValidate(tmpDir);
  const shared01 = result.checks.find((c) => c.id === "SHARED-01");
  expect(shared01?.status).toBe("fail");
});

// ---------------------------------------------------------------------------
// SHARED-02: exemption hygiene
// ---------------------------------------------------------------------------

test("SHARED-02 passes when no @warpgogol/werkstatt-site in EXEMPT_PREFIXES", async () => {
  const tmpDir = makeTmpDir();
  makeWorkspace(tmpDir);
  makePkgJson(tmpDir, { "@warpgogol/werkstatt-shared": "*" });
  makeAutonomyFile(tmpDir, AUTONOMY_CLEAN);

  const result = await runSharedValidate(tmpDir);
  const shared02 = result.checks.find((c) => c.id === "SHARED-02");
  expect(shared02?.status).toBe("pass");
});

test("SHARED-02 fails when @warpgogol/werkstatt-site is in EXEMPT_PREFIXES", async () => {
  const tmpDir = makeTmpDir();
  makeWorkspace(tmpDir);
  makePkgJson(tmpDir, { "@warpgogol/werkstatt-shared": "*" });
  makeAutonomyFile(tmpDir, AUTONOMY_WITH_SITE);

  const result = await runSharedValidate(tmpDir);
  const shared02 = result.checks.find((c) => c.id === "SHARED-02");
  expect(shared02?.status).toBe("fail");
});

// ---------------------------------------------------------------------------
// SHARED-03: no site imports in source
// ---------------------------------------------------------------------------

test("SHARED-03 passes when no @warpgogol/werkstatt-site imports exist", async () => {
  const tmpDir = makeTmpDir();
  const engineSrc = makeWorkspace(tmpDir);
  makePkgJson(tmpDir, { "@warpgogol/werkstatt-shared": "*" });
  makeAutonomyFile(tmpDir, AUTONOMY_CLEAN);
  writeFileSync(join(engineSrc, "a.ts"), `import { foo } from "zod";\n`);

  const result = await runSharedValidate(tmpDir);
  const shared03 = result.checks.find((c) => c.id === "SHARED-03");
  expect(shared03?.status).toBe("pass");
});

test("SHARED-03 fails when @warpgogol/werkstatt-site imports exist", async () => {
  const tmpDir = makeTmpDir();
  const engineSrc = makeWorkspace(tmpDir);
  makePkgJson(tmpDir, { "@warpgogol/werkstatt-shared": "*" });
  makeAutonomyFile(tmpDir, AUTONOMY_CLEAN);
  writeFileSync(join(engineSrc, "a.ts"), `import { foo } from "@warpgogol/werkstatt-site/checks";\n`);

  const result = await runSharedValidate(tmpDir);
  const shared03 = result.checks.find((c) => c.id === "SHARED-03");
  expect(shared03?.status).toBe("fail");
});

test("SHARED-03 ignores test files", async () => {
  const tmpDir = makeTmpDir();
  const engineSrc = makeWorkspace(tmpDir);
  makePkgJson(tmpDir, { "@warpgogol/werkstatt-shared": "*" });
  makeAutonomyFile(tmpDir, AUTONOMY_CLEAN);
  writeFileSync(join(engineSrc, "a.test.ts"), `import { foo } from "@warpgogol/werkstatt-site";\n`);

  const result = await runSharedValidate(tmpDir);
  const shared03 = result.checks.find((c) => c.id === "SHARED-03");
  expect(shared03?.status).toBe("pass");
});

// ---------------------------------------------------------------------------
// Overall result
// ---------------------------------------------------------------------------

test("overall status is pass when all three checks pass", async () => {
  const tmpDir = makeTmpDir();
  const engineSrc = makeWorkspace(tmpDir);
  makePkgJson(tmpDir, { "@warpgogol/werkstatt-shared": "*" });
  makeAutonomyFile(tmpDir, AUTONOMY_CLEAN);
  writeFileSync(join(engineSrc, "a.ts"), `import { foo } from "zod";\n`);

  const result = await runSharedValidate(tmpDir);
  expect(result.status).toBe("pass");
  expect(result.command).toBe("werkstatt.shared.validate");
  expect(result.checks).toHaveLength(3);
});

test("overall status is fail when any check fails", async () => {
  const tmpDir = makeTmpDir();
  makeWorkspace(tmpDir);
  makePkgJson(tmpDir, {});
  makeAutonomyFile(tmpDir, AUTONOMY_CLEAN);

  const result = await runSharedValidate(tmpDir);
  expect(result.status).toBe("fail");
});
