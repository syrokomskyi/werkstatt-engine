/*
<MODULE_CONTRACT>
<purpose>Tests for sternsystem.register extensions: amend path validation, flag handling, rollback (RFC-0532); intake seeding lives in sternsystem-register-intake.test.ts (RFC-1307).</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0532 review fix: add tests for extended sternsystem.register — amend validation, content stub, flag parsing.</item>
  <item>RFC-1307: steps 3-4 — deterministic intake seed planner and sternsystem.register --intake --biome</item>
  <item>RFC-1307: canonical org-singleton PBP paths, seeded hreflang+publication.gate, full rollback</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cp } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";
import { registerDeps, runSternsystemRegister } from "../sternsystem/sternsystem-register.ts";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";
import { expectData } from "./helpers/kernel-result-helpers.ts";
import { createDefaultIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";

let workspaceRoot: string;

function makeInput(flags: Record<string, unknown>): KernelCommandInput {
  return {
    flags: flags as Record<string, import("@warpgogol/werkstatt-engine/kernel").KernelFlagValue>,
    argv: [],
  };
}

function makeContext(root: string): KernelRuntimeContext {
  return {
    io: createDefaultIO().io,
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
  // RFC-1125: sternsystem.register preflight requires werkstatt.identity.json + signing key
  await writeFile(join(workspaceRoot, "werkstatt.identity.json"), "{}", "utf8");
  process.env.SIGNING_PRIVATE_KEY = "deadbeef".repeat(8);
});

afterEach(async () => {
  delete process.env.SIGNING_PRIVATE_KEY;
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

test("register rolls back registry entry, seeded files and system-state.yaml when mission.open fails", async () => {
  // RFC-1307: register needs a valid intake + biome before any write.
  const fixture = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "intake",
    "fixtures",
    "valid-minimal",
  );
  await cp(fixture, join(workspaceRoot, "onboarding", "dp7", ".input", "intake"), {
    recursive: true,
  });
  vi.spyOn(registerDeps, "checkBiome").mockResolvedValue(null);
  vi.spyOn(registerDeps, "openMission").mockRejectedValue(new Error("materialize failed"));
  const result = await runSternsystemRegister(
    makeInput({
      id: "dp7",
      cosmicStar: "Vega",
      mirrors: "../systems-cache/dp7:non-bare",
      intake: "onboarding/dp7/.input/intake",
      biome: "dp7-03",
    }),
    makeContext(workspaceRoot),
  );
  vi.restoreAllMocks();

  expect(expectData(result).status).toBe("fail");
  expect(result.exitCode).toBe(1);
  expect(expectData(result).diagnostics.some((d) => d.includes("failed"))).toBe(true);

  // systems-cache should be cleaned up entirely — config, seeded content and
  // the system-state.yaml writeSystemState created.
  const cacheDir = join(workspaceRoot, "..", "systems-cache", "dp7");
  expect(existsSync(join(cacheDir, "system-config.yaml"))).toBe(false);
  expect(existsSync(join(cacheDir, "system-state.yaml"))).toBe(false);
  expect(existsSync(join(cacheDir, "system.pin.json"))).toBe(false);
  expect(existsSync(join(cacheDir, "src", "content"))).toBe(false);
});

test("register rewinds clone commits to the pre-register HEAD on failure", async () => {
  // Cache clone is a real git repo with a pre-existing commit — register's
  // writeSystemState auto-commit and the scaffold commit must be rewound,
  // not left on the branch.
  const fixture = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "intake",
    "fixtures",
    "valid-minimal",
  );
  await cp(fixture, join(workspaceRoot, "onboarding", "dp7", ".input", "intake"), {
    recursive: true,
  });
  const cacheDir = join(workspaceRoot, "..", "systems-cache", "dp7");
  await mkdir(cacheDir, { recursive: true });
  const git = (args: string) =>
    execSync(`git ${args}`, { cwd: cacheDir, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  git("init -b main");
  git("config user.email test@test");
  git("config user.name test");
  await writeFile(join(cacheDir, "README.md"), "pre-register\n", "utf8");
  git("add -A");
  git('commit -m "pre-register"');
  const preSha = git("rev-parse HEAD");

  vi.spyOn(registerDeps, "checkBiome").mockResolvedValue(null);
  vi.spyOn(registerDeps, "openMission").mockRejectedValue(new Error("materialize failed"));
  const result = await runSternsystemRegister(
    makeInput({
      id: "dp7",
      cosmicStar: "Vega",
      mirrors: "../systems-cache/dp7:non-bare",
      intake: "onboarding/dp7/.input/intake",
      biome: "dp7-03",
    }),
    makeContext(workspaceRoot),
  );
  vi.restoreAllMocks();

  expect(expectData(result).status).toBe("fail");
  expect(git("rev-parse HEAD")).toBe(preSha);
  expect(existsSync(join(cacheDir, "system-state.yaml"))).toBe(false);
  expect(existsSync(join(cacheDir, "system-config.yaml"))).toBe(false);
  expect(existsSync(join(cacheDir, "src", "content"))).toBe(false);
  expect(existsSync(join(cacheDir, "README.md"))).toBe(true);
});

test("register rejects a non-conventional mirrors[0] before any write", async () => {
  const fixture = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "intake",
    "fixtures",
    "valid-minimal",
  );
  await cp(fixture, join(workspaceRoot, "onboarding", "dp7", ".input", "intake"), {
    recursive: true,
  });
  vi.spyOn(registerDeps, "checkBiome").mockResolvedValue(null);
  await expect(
    runSternsystemRegister(
      makeInput({
        id: "dp7",
        cosmicStar: "Vega",
        mirrors: "./nonexistent-repo-path",
        intake: "onboarding/dp7/.input/intake",
        biome: "dp7-03",
      }),
      makeContext(workspaceRoot),
    ),
  ).rejects.toThrow(/mirrors\[0\] must be the conventional/);
});
