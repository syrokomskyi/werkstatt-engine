import { test, expect } from "vitest";
import type { KernelLogger, KernelRuntimeContext, WorkspaceIO } from "@warpgogol/werkstatt-engine/kernel";
import { runObservabilityWorkersValidate } from "../commands/workers-validate.ts";

/*
<MODULE_CONTRACT>
<purpose>
Regression coverage for observability.workers.validate using an in-memory
WorkspaceIO fixture so the command's JSONC parsing and Wrangler contract checks
stay fast, offline, and deterministic.
</purpose>
<non-goals>
  <item>Do not exercise real workspace files or Cloudflare APIs.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Post-refactor hardening: add concrete tests for the package's advertised vitest signal.</item>
</CHANGE_SUMMARY>
*/

const noopLogger: KernelLogger = {
  section() {},
  info() {},
  warn() {},
  error() {},
  success() {},
  event() {},
  getEvents() {
    return [];
  },
};

function matchesWranglerGlob(pattern: string, file: string): boolean {
  if (pattern === "apps/*/wrangler.jsonc") {
    return /^apps\/[^/]+\/wrangler\.jsonc$/.test(file);
  }
  if (pattern === "services/*/wrangler.jsonc") {
    return /^services\/[^/]+\/wrangler\.jsonc$/.test(file);
  }
  return pattern === file;
}

function relFromFixturePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^C:\/fixture\//, "");
}

function contextFor(files: Record<string, string>): KernelRuntimeContext {
  const io: WorkspaceIO = {
    async readFile(filePath) {
      const rel = relFromFixturePath(filePath);
      const content = files[rel];
      if (content === undefined) throw new Error(`Missing fixture file: ${rel}`);
      return content;
    },
    async readFileBytes(filePath) {
      return new TextEncoder().encode(await this.readFile(filePath));
    },
    async exists(filePath) {
      return files[relFromFixturePath(filePath)] !== undefined;
    },
    async glob(pattern) {
      return Object.keys(files).filter((file) => matchesWranglerGlob(pattern, file));
    },
    async readdir() {
      return [];
    },
    async writeFile() {
      throw new Error("test fixture is read-only");
    },
    async mkdir() {
      throw new Error("test fixture is read-only");
    },
    async rm() {
      throw new Error("test fixture is read-only");
    },
    async exec() {
      throw new Error("test fixture does not execute commands");
    },
  };

  return {
    workspaceRoot: "C:/fixture",
    siteExplicit: false,
    logger: noopLogger,
    dryRun: false,
    outputFormat: "json",
    io,
  };
}

test("observability.workers.validate accepts JSONC wrangler configs with signoz traces", async () => {
  const result = await runObservabilityWorkersValidate(
    { argv: [], flags: {} },
    contextFor({
      "services/fleet-probe-runner/wrangler.jsonc": `{
        // JSONC comments and trailing commas are allowed by Wrangler.
        "main": "src/index.ts",
        "observability": {
          "traces": {
            "enabled": true,
            "destinations": ["signoz"],
            "head_sampling_rate": 1.0,
          },
          "logs": { "enabled": true },
        },
      }`,
    }),
  );

  expect(result.exitCode).toBe(0);
  expect(result.data?.diagnostics).toEqual([]);
});

test("observability.workers.validate rejects deployable wrangler configs without traces enabled", async () => {
  const result = await runObservabilityWorkersValidate(
    { argv: [], flags: {} },
    contextFor({
      "services/fleet-probe-runner/wrangler.jsonc": `{
        "main": "src/index.ts",
        "observability": {
          "logs": { "enabled": true }
        }
      }`,
    }),
  );

  expect(result.exitCode).toBe(1);
  expect(result.data?.diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        ruleId: "OBS-WRK-01",
        file: "services/fleet-probe-runner/wrangler.jsonc",
      }),
    ]),
  );
});
