/*
<MODULE_CONTRACT>
<purpose>RFC-0896: tests for redirect.register command handler — idempotency, new registration, mismatched DNS, mismatched redirect rule, missing env.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0896: initial redirect.register tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runRedirectRegister } from "../customdomain/redirect-register.ts";
import type { KernelRuntimeContext, KernelCommandInput } from "@warpgogol/werkstatt-engine/kernel";
import { setupCloudflareApiMock, cfSuccessResponse } from "./helpers/cloudflare-api-mock.ts";
import { buildSystemConfig } from "./helpers/registry-builder.ts";
import { expectData } from "./helpers/kernel-result-helpers.ts";

let tmpDir: string;
let parentDir: string;
let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  parentDir = mkdtempSync(join(tmpdir(), "tmp-redirect-register-"));
  tmpDir = join(parentDir, "workspace");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ version: "1.0.0" }) + "\n");
  mockFetch = vi.fn();
  vi.stubGlobal("fetch", mockFetch);
  process.env.CLOUDFLARE_API_TOKEN = "test-token";
});

afterEach(() => {
  rmSync(parentDir, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete process.env.CLOUDFLARE_API_TOKEN;
});

function makeContext(workspaceRoot: string): KernelRuntimeContext {
  return {
    workspaceRoot,
    logger: {
      info: () => {},
      success: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
    flags: {},
    env: {},
  } as unknown as KernelRuntimeContext;
}

function makeInput(flags: Record<string, string>): KernelCommandInput {
  return { flags, argv: [] };
}

function createSystemConfig(workspaceRoot: string, opts?: { withZoneId?: boolean }): void {
  const cacheDir = join(workspaceRoot, "..", "systems-cache", "warpgogol-com");
  mkdirSync(cacheDir, { recursive: true });
  const configContent = buildSystemConfig({
    id: "warpgogol-com",
    cosmicStar: "Vega",
    mirrors: [{ path: "/tmp/test-cache", storageType: "non-bare" }],
    pinnedPlatform: "1.0.0",
    notes: "",
    cloudflareZoneId: opts?.withZoneId !== false ? "zone-123" : undefined,
    deployment: {
      adapter: "cloudflare-workers",
      channels: {
        dev: { workerName: "wg-dev", url: "https://dev.warpgogol.com" },
        alt: { workerName: "wg-alt", url: "https://alt.warpgogol.com" },
        main: { workerName: "warpgogol-com", url: "https://warpgogol.com" },
      },
    },
  });
  writeFileSync(join(cacheDir, "system-config.yaml"), configContent);
}

const expectedExpression = '(http.host eq "www.warpgogol.com")';
const expectedDescription = "www → apex 301 (warpgogol-com)";
const expectedTargetExpression = 'concat("https://warpgogol.com", http.request.uri.path)';

test("registers new CNAME and Redirect Rule when none exist", async () => {
  createSystemConfig(tmpDir);

  let createdDns = false;
  let createdRule = false;

  setupCloudflareApiMock(mockFetch, {
    createDns: () => {
      createdDns = true;
      return cfSuccessResponse({
        id: "dns-new",
        type: "CNAME",
        name: "www.warpgogol.com",
        content: "warpgogol.com",
        proxied: true,
      });
    },
    redirectRuleset: () =>
      cfSuccessResponse({
        id: "ruleset-1",
        name: "redirect",
        phase: "http_request_dynamic_redirect",
        rules: [],
      }),
    createRedirectRule: () => {
      createdRule = true;
      return cfSuccessResponse({
        id: "rule-new",
        description: expectedDescription,
        enabled: true,
        action: "redirect",
        expression: expectedExpression,
        action_parameters: {
          status_code: 301,
          target_url: { expression: expectedTargetExpression },
        },
      });
    },
  });

  const result = await runRedirectRegister(
    makeInput({ site: "warpgogol-com" }),
    makeContext(tmpDir),
  );
  const data = expectData(result);

  expect(data.state).toBe("registered");
  expect(data.dnsRecord.created).toBe(true);
  expect(data.dnsRecord.id).toBe("dns-new");
  expect(data.dnsRecord.type).toBe("CNAME");
  expect(data.dnsRecord.name).toBe("www.warpgogol.com");
  expect(data.dnsRecord.content).toBe("warpgogol.com");
  expect(data.redirectRule.created).toBe(true);
  expect(data.redirectRule.id).toBe("rule-new");
  expect(data.wwwDomain).toBe("www.warpgogol.com");
  expect(data.apexDomain).toBe("warpgogol.com");
  expect(createdDns).toBe(true);
  expect(createdRule).toBe(true);
});

test("is idempotent — skips creation when CNAME and Redirect Rule already correct", async () => {
  createSystemConfig(tmpDir);

  let createdDns = false;
  let createdRule = false;

  setupCloudflareApiMock(mockFetch, {
    dnsList: () =>
      cfSuccessResponse([
        {
          id: "dns-existing",
          type: "CNAME",
          name: "www.warpgogol.com",
          content: "warpgogol.com",
          proxied: true,
        },
      ]),
    redirectRuleset: () =>
      cfSuccessResponse({
        id: "ruleset-1",
        name: "redirect",
        phase: "http_request_dynamic_redirect",
        rules: [
          {
            id: "rule-existing",
            description: expectedDescription,
            enabled: true,
            action: "redirect",
            expression: expectedExpression,
            action_parameters: {
              status_code: 301,
              target_url: { expression: expectedTargetExpression },
            },
          },
        ],
      }),
    createDns: () => {
      createdDns = true;
      return cfSuccessResponse({});
    },
    createRedirectRule: () => {
      createdRule = true;
      return cfSuccessResponse({});
    },
  });

  const result = await runRedirectRegister(
    makeInput({ site: "warpgogol-com" }),
    makeContext(tmpDir),
  );
  const data = expectData(result);

  expect(data.state).toBe("already-registered");
  expect(data.dnsRecord.created).toBe(false);
  expect(data.dnsRecord.id).toBe("dns-existing");
  expect(data.redirectRule.created).toBe(false);
  expect(data.redirectRule.id).toBe("rule-existing");
  expect(createdDns).toBe(false);
  expect(createdRule).toBe(false);
});

test("errors when DNS record exists with wrong content", async () => {
  createSystemConfig(tmpDir);

  setupCloudflareApiMock(mockFetch, {
    dnsList: () =>
      cfSuccessResponse([
        {
          id: "dns-wrong",
          type: "CNAME",
          name: "www.warpgogol.com",
          content: "wrong.example.com",
          proxied: true,
        },
      ]),
  });

  await expect(
    runRedirectRegister(makeInput({ site: "warpgogol-com" }), makeContext(tmpDir)),
  ).rejects.toThrow("DNS record for 'www.warpgogol.com' exists but has wrong values");
});

test("errors when Redirect Rule exists with wrong status code", async () => {
  createSystemConfig(tmpDir);

  setupCloudflareApiMock(mockFetch, {
    dnsList: () =>
      cfSuccessResponse([
        {
          id: "dns-ok",
          type: "CNAME",
          name: "www.warpgogol.com",
          content: "warpgogol.com",
          proxied: true,
        },
      ]),
    redirectRuleset: () =>
      cfSuccessResponse({
        id: "ruleset-1",
        name: "redirect",
        phase: "http_request_dynamic_redirect",
        rules: [
          {
            id: "rule-wrong",
            description: expectedDescription,
            enabled: true,
            action: "redirect",
            expression: expectedExpression,
            action_parameters: {
              status_code: 302,
              target_url: { expression: expectedTargetExpression },
            },
          },
        ],
      }),
  });

  await expect(
    runRedirectRegister(makeInput({ site: "warpgogol-com" }), makeContext(tmpDir)),
  ).rejects.toThrow("Redirect Rule for 'www.warpgogol.com' exists but has wrong values");
});

test("errors when CLOUDFLARE_API_TOKEN is missing", async () => {
  createSystemConfig(tmpDir);
  delete process.env.CLOUDFLARE_API_TOKEN;

  await expect(
    runRedirectRegister(makeInput({ site: "warpgogol-com" }), makeContext(tmpDir)),
  ).rejects.toThrow("CLOUDFLARE_API_TOKEN is required");
});

test("errors when cloudflareZoneId is missing from system config", async () => {
  createSystemConfig(tmpDir, { withZoneId: false });

  await expect(
    runRedirectRegister(makeInput({ site: "warpgogol-com" }), makeContext(tmpDir)),
  ).rejects.toThrow("cloudflareZoneId");
});

test("errors when --site is missing", async () => {
  createSystemConfig(tmpDir);

  await expect(runRedirectRegister(makeInput({}), makeContext(tmpDir))).rejects.toThrow(
    "--site is required",
  );
});
