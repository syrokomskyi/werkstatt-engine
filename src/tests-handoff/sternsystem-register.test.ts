/*
<MODULE_CONTRACT>
<purpose>Tests for RFC-0532 sternsystem.register extensions: amend path validation, content stub creation, flag handling.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0532 review fix: add tests for extended sternsystem.register — amend validation, content stub, flag parsing.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSternsystemRegister, createContentStub } from "../sternsystem/sternsystem-register.ts";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";
import { expectData } from "./helpers/kernel-result-helpers.ts";

let workspaceRoot: string;

function makeInput(flags: Record<string, unknown>): KernelCommandInput {
  return {
    flags: flags as Record<string, import("@warpgogol/werkstatt-engine/kernel").KernelFlagValue>,
    argv: [],
  };
}

function makeContext(root: string): KernelRuntimeContext {
  return {
    workspaceRoot: root,
    logger: {
      section: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      success: () => {},
    },
    dryRun: false,
  } as unknown as KernelRuntimeContext;
}

const VALID_BRIEF = `---
client:
  id: test-client
  domain: example.com
i18n:
  default: de
  supported:
    - de
    - en
legalJurisdiction: DE
---

# Test brief
`;

beforeEach(async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "sternsystem-register-test-"));
  workspaceRoot = join(testRoot, "workspace");
  await mkdir(workspaceRoot, { recursive: true });
  await mkdir(join(workspaceRoot, "docs", "rfcs"), { recursive: true });
  await writeFile(join(workspaceRoot, "docs", "rfcs", "RFC-0001-test.md"), "", "utf8");
  await writeFile(
    join(workspaceRoot, "package.json"),
    JSON.stringify({ version: "4.5.0" }),
    "utf8",
  );
  await writeFile(
    join(workspaceRoot, "uni.registry.yaml"),
    JSON.stringify({ entries: [{ id: "test", semanticId: "test", version: "1.0.0", intent: [] }] }),
    "utf8",
  );
  await mkdir(join(workspaceRoot, "packages", "dummy"), { recursive: true });
  await writeFile(
    join(workspaceRoot, "packages", "dummy", "index.ts"),
    "export const x = 1;\n",
    "utf8",
  );
});

afterEach(async () => {
  await rm(join(workspaceRoot, ".."), { recursive: true, force: true });
});

test("amend fails when system does not exist in registry", async () => {
  await expect(
    runSternsystemRegister(
      makeInput({ id: "nonexistent", amend: true }),
      makeContext(workspaceRoot),
    ),
  ).rejects.toThrow(/ENOENT|does not exist|system-config/);
});

test("amend fails when id is not provided", async () => {
  await expect(
    runSternsystemRegister(makeInput({ amend: true }), makeContext(workspaceRoot)),
  ).rejects.toThrow(/requires --id/);
});

test("register fails when cosmicStar is not provided (non-amend)", async () => {
  await expect(
    runSternsystemRegister(
      makeInput({ id: "test-bundle", mirrors: "git@github.com:foo/test.git" }),
      makeContext(workspaceRoot),
    ),
  ).rejects.toThrow(/requires --cosmicStar/);
});

test("register fails when mirrors is not provided (non-amend)", async () => {
  await expect(
    runSternsystemRegister(
      makeInput({ id: "test-bundle", cosmicStar: "Vega" }),
      makeContext(workspaceRoot),
    ),
  ).rejects.toThrow(/requires --mirrors/);
});

test("createContentStub creates system.md from brief", async () => {
  const inputDir = join(workspaceRoot, "onboarding", "test-client", ".input");
  await mkdir(inputDir, { recursive: true });
  await writeFile(join(inputDir, "00-brief.md"), VALID_BRIEF, "utf8");

  await mkdir(join(workspaceRoot, "systems", "test-client"), { recursive: true });

  await createContentStub(
    workspaceRoot,
    "test-client",
    join(workspaceRoot, "systems", "test-client"),
  );

  const systemMdPath = join(workspaceRoot, "systems", "test-client", "src", "content", "system.md");
  expect(existsSync(systemMdPath)).toBe(true);

  const systemMd = await readFile(systemMdPath, "utf8");
  expect(systemMd).toContain("domain: example.com");
  expect(systemMd).toContain("default: de");
  expect(systemMd).toContain("legalJurisdiction: DE");
});

test("createContentStub is a no-op when brief does not exist", async () => {
  await mkdir(join(workspaceRoot, "systems", "test-client"), { recursive: true });

  await createContentStub(
    workspaceRoot,
    "test-client",
    join(workspaceRoot, "systems", "test-client"),
  );

  const systemMdPath = join(workspaceRoot, "systems", "test-client", "src", "content", "system.md");
  expect(existsSync(systemMdPath)).toBe(false);
});

test("register rejects TLD-suffixed IDs (RFC-0902)", async () => {
  await expect(
    runSternsystemRegister(
      makeInput({
        id: "warpgogol-com",
        cosmicStar: "Vega",
        mirrors: "git@github.com:foo/test.git",
      }),
      makeContext(workspaceRoot),
    ),
  ).rejects.toThrow(/TLD suffix/);
});

test("register rejects TLD-suffixed IDs with --amend (RFC-0902)", async () => {
  await expect(
    runSternsystemRegister(
      makeInput({ id: "warpgogol-com", amend: true }),
      makeContext(workspaceRoot),
    ),
  ).rejects.toThrow(/TLD suffix/);
});

test("register rolls back registry entry when materialize fails", async () => {
  // Register will fail at mission.materialize because the mirrors point to a
  // non-existent local path — git clone fails immediately instead of hanging on SSH.
  const result = await runSternsystemRegister(
    makeInput({ id: "test-bundle", cosmicStar: "Vega", mirrors: "./nonexistent-repo-path" }),
    makeContext(workspaceRoot),
  );

  expect(expectData(result).status).toBe("fail");
  expect(result.exitCode).toBe(1);
  expect(expectData(result).diagnostics.some((d) => d.includes("failed"))).toBe(true);

  // systems-cache should be cleaned up (no system-config.yaml for test-bundle)
  const cacheDir = join(workspaceRoot, "..", "systems-cache", "test-bundle");
  const configPath = join(cacheDir, "system-config.yaml");
  expect(existsSync(configPath)).toBe(false);
});
