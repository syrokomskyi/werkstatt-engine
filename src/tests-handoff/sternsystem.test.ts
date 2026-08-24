/*
<MODULE_CONTRACT>
<purpose>RFC-0354: tests for sternsystem.register, .list, .validate, .pin commands.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0354: initial sternsystem command tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSternsystemRegister } from "../sternsystem/sternsystem-register.ts";
import { runSternsystemList } from "../sternsystem/sternsystem-list.ts";
import { runSternsystemValidate } from "../sternsystem/sternsystem-validate.ts";
import { runSternsystemPin } from "../sternsystem/sternsystem-pin.ts";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";
import { expectData } from "./helpers/kernel-result-helpers.ts";

let testRoot: string;
let workspaceRoot: string;
let cacheRoot: string;

async function writeSystemConfigFile(
  systemId: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  const dir = join(cacheRoot, systemId);
  await mkdir(dir, { recursive: true });
  const config = {
    schemaVersion: "system-config/v1",
    id: systemId,
    cosmicStar: "Vega",
    mirrors: [{ path: `../systems-cache/${systemId}`, storageType: "non-bare" }],
    pinnedPlatform: "4.5.0",
    status: "active",
    registeredAt: "2026-01-01T00:00:00Z",
    notes: "",
    ...overrides,
  };
  const { stringify: stringifyYaml } = await import("yaml");
  await writeFile(join(dir, "system-config.yaml"), stringifyYaml(config) + "\n", "utf8");

  // Write a minimal pin file so validate doesn't report pin-missing
  const pin = {
    schemaVersion: "system-pin/v1",
    systemId,
    cosmicStar: config.cosmicStar,
    pinnedAt: "2026-01-01T00:00:00Z",
    platform: {
      version: "4.5.0",
      commit: "abcdef0",
      rfcHead: "RFC-0001",
      platformSemanticHash:
        "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    },
    migratorCursor: [],
    capabilities: [],
  };
  await writeFile(join(dir, "system.pin.json"), JSON.stringify(pin, null, 2) + "\n", "utf8");
}

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

beforeEach(async () => {
  testRoot = await mkdtemp(join(tmpdir(), "sternsystem-test-"));
  workspaceRoot = join(testRoot, "workspace");
  cacheRoot = join(testRoot, "systems-cache");
  await mkdir(workspaceRoot, { recursive: true });
  await mkdir(cacheRoot, { recursive: true });
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
  // Minimal packages/ dir so resolvePlatformSemanticHash can fingerprint it
  await mkdir(join(workspaceRoot, "packages", "dummy"), { recursive: true });
  await writeFile(
    join(workspaceRoot, "packages", "dummy", "index.ts"),
    "export const x = 1;\n",
    "utf8",
  );
});

afterEach(async () => {
  await rm(testRoot, { recursive: true, force: true });
});

test("register fails on duplicate id", async () => {
  // Pre-create a system config to simulate an existing Sternsystem
  await writeSystemConfigFile("test-bundle");

  await expect(
    runSternsystemRegister(
      makeInput({
        id: "test-bundle",
        cosmicStar: "Sirius",
        mirrors: "../systems-cache/test-bundle",
      }),
      makeContext(workspaceRoot),
    ),
  ).rejects.toThrow(/already exists/);
});

test("register fails on invalid cosmicStar", async () => {
  await expect(
    runSternsystemRegister(
      makeInput({
        id: "test-bundle",
        cosmicStar: "NotAStar",
        mirrors: "../systems-cache/test-bundle",
      }),
      makeContext(workspaceRoot),
    ),
  ).rejects.toThrow(/not in StarCatalog/);
});

test("register fails on apps/ collision", async () => {
  await mkdir(join(workspaceRoot, "apps", "test-bundle"), { recursive: true });
  await expect(
    runSternsystemRegister(
      makeInput({ id: "test-bundle", cosmicStar: "Vega", mirrors: "../systems-cache/test-bundle" }),
      makeContext(workspaceRoot),
    ),
  ).rejects.toThrow(/extract first/);
});

test("validate passes for a system with a local path repo", async () => {
  await writeSystemConfigFile("test-bundle");

  const result = await runSternsystemValidate(makeInput({}), makeContext(workspaceRoot));
  expect(expectData(result).violations).toHaveLength(0);
});

test("list returns all registered systems", async () => {
  await writeSystemConfigFile("site-a", { cosmicStar: "Vega" });
  await writeSystemConfigFile("site-b", { cosmicStar: "Sirius" });

  const result = await runSternsystemList(makeInput({}), makeContext(workspaceRoot));
  expect(expectData(result).count).toBe(2);
  expect(expectData(result).systems.map((s) => s.id)).toEqual(["site-a", "site-b"]);
});

test("validate passes on a clean registry", async () => {
  await writeSystemConfigFile("test-bundle");

  const result = await runSternsystemValidate(makeInput({}), makeContext(workspaceRoot));
  expect(expectData(result).validated).toBe(1);
  expect(expectData(result).violations).toHaveLength(0);
  expect(result.exitCode).toBe(0);
});

test("validate detects apps/ collision", async () => {
  await writeSystemConfigFile("test-bundle");
  await mkdir(join(workspaceRoot, "apps", "test-bundle"), { recursive: true });

  const result = await runSternsystemValidate(makeInput({}), makeContext(workspaceRoot));
  expect(expectData(result).violations).toHaveLength(1);
  expect(expectData(result).violations[0].rule).toBe("apps-collision");
  expect(result.exitCode).toBe(1);
});

test("validate detects TLD-suffixed IDs (RFC-0902 STERN-ID-TLD)", async () => {
  await writeSystemConfigFile("warpgogol-com");

  const result = await runSternsystemValidate(makeInput({}), makeContext(workspaceRoot));
  const tldViolation = expectData(result).violations.find((v) => v.rule === "STERN-ID-TLD");
  expect(tldViolation).toBeDefined();
  expect(tldViolation?.systemId).toBe("warpgogol-com");
  expect(tldViolation?.message).toContain("warpgogol-com");
  expect(result.exitCode).toBe(1);
});

test("pin writes system.pin.json and activates the system", async () => {
  await writeSystemConfigFile("test-bundle");

  const result = await runSternsystemPin(
    makeInput({ id: "test-bundle", platform: "4.5.0" }),
    makeContext(workspaceRoot),
  );
  expect(expectData(result).systemId).toBe("test-bundle");
  expect(expectData(result).platform).toBe("4.5.0");

  const pinPath = join(cacheRoot, "test-bundle", "system.pin.json");
  expect(existsSync(pinPath)).toBe(true);

  const pin = JSON.parse(await readFile(pinPath, "utf8"));
  expect(pin.systemId).toBe("test-bundle");
  expect(pin.cosmicStar).toBe("Vega");
  expect(pin.platform.version).toBe("4.5.0");
  expect(pin.platform.platformSemanticHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  expect(pin.migratorCursor).toEqual([
    "rfc-0479",
    "rfc-0481",
    "rfc-0483",
    "rfc-0488",
    "rfc-0492",
    "rfc-0495",
    "rfc-0496",
    "rfc-0497",
    "rfc-0498",
    "rfc-0500",
    "rfc-0501",
    "rfc-0502",
    "rfc-0504",
    "rfc-0505",
    "rfc-0506",
    "rfc-0508",
    "rfc-0512",
    "rfc-0514",
    "rfc-0529",
    "rfc-0548",
    "rfc-0572",
    "rfc-0757",
    "rfc-0885",
  ]);
});

test("pin refuses downgrade", async () => {
  await writeSystemConfigFile("test-bundle");

  // Write an initial pin at 4.5.0
  await runSternsystemPin(
    makeInput({ id: "test-bundle", platform: "4.5.0" }),
    makeContext(workspaceRoot),
  );

  // Attempt to pin to an older version
  await expect(
    runSternsystemPin(
      makeInput({ id: "test-bundle", platform: "4.4.0" }),
      makeContext(workspaceRoot),
    ),
  ).rejects.toThrow(/never downgraded/);
});
