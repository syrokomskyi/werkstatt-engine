/*
<MODULE_CONTRACT>
<purpose>Unit tests for sternsystem.register — RFC-1125 identity + signing-key preflight (AC-3): register blocks before any file ops when werkstatt.identity.json or the signing key is missing.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1125: preflight tests — missing identity, missing key, and combined-missing cases all throw with an identity.bootstrap fixHint.</item>
</CHANGE_SUMMARY>
*/

import "./load-verification.test.ts";

import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSternsystemRegister } from "../sternsystem-register.ts";
import { IDENTITY_CONFIG_FILENAME } from "../../identity/identity-io.ts";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";

let tempDir: string;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "sternsystem-register-"));
  for (const key of ["SIGNING_PRIVATE_KEY", "SIGNING_PRIVATE_KEY_PATH"]) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(async () => {
  for (const key of ["SIGNING_PRIVATE_KEY", "SIGNING_PRIVATE_KEY_PATH"]) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  await rm(tempDir, { recursive: true, force: true });
});

function makeInput(): KernelCommandInput {
  return { args: [], flags: { id: "acme" } } as unknown as KernelCommandInput;
}

function makeContext(): KernelRuntimeContext {
  return {
    workspaceRoot: tempDir,
    logger: { info: () => {}, warn: () => {}, error: () => {}, success: () => {} },
  } as unknown as KernelRuntimeContext;
}

test("blocks when werkstatt.identity.json and signing key are both missing", async () => {
  await expect(runSternsystemRegister(makeInput(), makeContext())).rejects.toThrow(
    /identity\.bootstrap/,
  );
});

test("blocks when signing key is missing even with identity.json present", async () => {
  await writeFile(join(tempDir, IDENTITY_CONFIG_FILENAME), "{}");
  await expect(runSternsystemRegister(makeInput(), makeContext())).rejects.toThrow(
    /SIGNING_PRIVATE_KEY/,
  );
});

test("blocks when identity.json is missing even with signing key set", async () => {
  process.env.SIGNING_PRIVATE_KEY = "deadbeef".repeat(8);
  await expect(runSternsystemRegister(makeInput(), makeContext())).rejects.toThrow(
    /werkstatt\.identity\.json/,
  );
});

test("preflight fires before any file ops — no systems-cache or missions created", async () => {
  await expect(runSternsystemRegister(makeInput(), makeContext())).rejects.toThrow();
  // The preflight throws before discoverSystems/mission.open — nothing materialized
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(tempDir);
  expect(entries.filter((e) => e !== IDENTITY_CONFIG_FILENAME)).toHaveLength(0);
});
