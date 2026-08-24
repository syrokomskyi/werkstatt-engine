/*
<MODULE_CONTRACT>
<purpose>RFC-0752: tests for subdomain.validate command handler — valid, not-registered, mismatched states.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0752: initial subdomain.validate tests.</item>
  <item>ADR-0035: refactored to use shared cloudflare-api-mock helper (setupCloudflareApiMock).</item>
  <item>ADR-0036: refactored to use shared registry-builder helper (buildRegistry).</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runSubdomainValidate } from "../subdomain/subdomain-validate.ts";
import type { KernelRuntimeContext, KernelCommandInput } from "@warpgogol/werkstatt-engine/kernel";
import {
  setupCloudflareApiMock,
  dnsListResponse,
  routeListResponse,
} from "./helpers/cloudflare-api-mock.ts";
import { buildSystemConfig, buildServicesRegistry } from "./helpers/registry-builder.ts";
import { expectData } from "./helpers/kernel-result-helpers.ts";
import { tmpdir } from "node:os";

let tmpDir: string;
let parentDir: string;
let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  parentDir = mkdtempSync(join(tmpdir(), "tmp-subdomain-validate-"));
  tmpDir = join(parentDir, "workspace");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ version: "1.0.0" }) + "\n");
  mockFetch = vi.fn();
  vi.stubGlobal("fetch", mockFetch);
  process.env.CLOUDFLARE_API_TOKEN = "test-token";
  process.env.CLOUDFLARE_ACCOUNT_ID = "test-account";
});

afterEach(() => {
  rmSync(parentDir, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete process.env.CLOUDFLARE_API_TOKEN;
  delete process.env.CLOUDFLARE_ACCOUNT_ID;
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

function createRegistry(workspaceRoot: string): void {
  const cacheDir = join(workspaceRoot, "..", "systems-cache", "warpgogol-com");
  mkdirSync(cacheDir, { recursive: true });
  const configContent = buildSystemConfig({
    id: "warpgogol-com",
    cosmicStar: "Vega",
    mirrors: [{ path: "/tmp/test-cache", storageType: "non-bare" }],
    pinnedPlatform: "1.0.0",
    notes: "",
    cloudflareZoneId: "zone-123",
    deployment: {
      adapter: "cloudflare-workers",
      channels: {
        dev: { workerName: "wg-dev", url: "https://dev.warpgogol.com" },
        alt: { workerName: "wg-alt", url: "https://alt.warpgogol.com" },
        main: { workerName: "wg-main", url: "https://warpgogol.com" },
      },
    },
  });
  writeFileSync(join(cacheDir, "system-config.yaml"), configContent);

  const servicesDir = join(workspaceRoot, "services");
  mkdirSync(servicesDir, { recursive: true });
  const servicesContent = buildServicesRegistry({
    systems: [],
    services: [
      {
        id: "matomo-proxy",
        kind: "proxy-worker",
        workerName: "matomo-proxy",
        hostedBy: "studio",
        url: "https://matomo-proxy.warpgogol.com",
        subdomains: [{ domain: "matomo-proxy.warpgogol.com", zone: "warpgogol.com" }],
      },
    ],
  });
  writeFileSync(join(servicesDir, "registry.yaml"), servicesContent);
}

test("reports valid when both DNS and route exist and are correct", async () => {
  createRegistry(tmpDir);

  setupCloudflareApiMock(mockFetch, {
    dnsList: () =>
      dnsListResponse([
        {
          id: "dns-ok",
          type: "CNAME",
          name: "matomo-proxy.warpgogol.com",
          content: "matomo-proxy.test-account.workers.dev",
          proxied: true,
        },
      ]),
    routeList: () =>
      routeListResponse([
        {
          id: "route-ok",
          pattern: "matomo-proxy.warpgogol.com/*",
          script: "matomo-proxy",
        },
      ]),
  });

  const result = await runSubdomainValidate(
    makeInput({ service: "matomo-proxy" }),
    makeContext(tmpDir),
  );

  expect(expectData(result).state).toBe("valid");
  expect(expectData(result).dnsRecord.correct).toBe(true);
  expect(expectData(result).workersRoute.correct).toBe(true);
});

test("reports not-registered when both DNS and route are missing", async () => {
  createRegistry(tmpDir);

  setupCloudflareApiMock(mockFetch, {
    dnsList: () => dnsListResponse([]),
    routeList: () => routeListResponse([]),
  });

  const result = await runSubdomainValidate(
    makeInput({ service: "matomo-proxy" }),
    makeContext(tmpDir),
  );

  expect(expectData(result).state).toBe("not-registered");
  expect(expectData(result).dnsRecord.exists).toBe(false);
  expect(expectData(result).workersRoute.exists).toBe(false);
});

test("reports mismatched when DNS has wrong target", async () => {
  createRegistry(tmpDir);

  setupCloudflareApiMock(mockFetch, {
    dnsList: () =>
      dnsListResponse([
        {
          id: "dns-wrong",
          type: "CNAME",
          name: "matomo-proxy.warpgogol.com",
          content: "wrong-target.workers.dev",
          proxied: true,
        },
      ]),
    routeList: () =>
      routeListResponse([
        {
          id: "route-ok",
          pattern: "matomo-proxy.warpgogol.com/*",
          script: "matomo-proxy",
        },
      ]),
  });

  const result = await runSubdomainValidate(
    makeInput({ service: "matomo-proxy" }),
    makeContext(tmpDir),
  );

  expect(expectData(result).state).toBe("mismatched");
  expect(expectData(result).dnsRecord.correct).toBe(false);
  expect(expectData(result).dnsRecord.exists).toBe(true);
});

test("reports mismatched when Workers route has wrong script", async () => {
  createRegistry(tmpDir);

  setupCloudflareApiMock(mockFetch, {
    dnsList: () =>
      dnsListResponse([
        {
          id: "dns-ok",
          type: "CNAME",
          name: "matomo-proxy.warpgogol.com",
          content: "matomo-proxy.test-account.workers.dev",
          proxied: true,
        },
      ]),
    routeList: () =>
      routeListResponse([
        {
          id: "route-wrong",
          pattern: "matomo-proxy.warpgogol.com/*",
          script: "wrong-worker",
        },
      ]),
  });

  const result = await runSubdomainValidate(
    makeInput({ service: "matomo-proxy" }),
    makeContext(tmpDir),
  );

  expect(expectData(result).state).toBe("mismatched");
  expect(expectData(result).workersRoute.correct).toBe(false);
  expect(expectData(result).workersRoute.exists).toBe(true);
});

test("reports not-registered when DNS exists but route is missing", async () => {
  createRegistry(tmpDir);

  setupCloudflareApiMock(mockFetch, {
    dnsList: () =>
      dnsListResponse([
        {
          id: "dns-ok",
          type: "CNAME",
          name: "matomo-proxy.warpgogol.com",
          content: "matomo-proxy.test-account.workers.dev",
          proxied: true,
        },
      ]),
    routeList: () => routeListResponse([]),
  });

  const result = await runSubdomainValidate(
    makeInput({ service: "matomo-proxy" }),
    makeContext(tmpDir),
  );

  expect(expectData(result).state).toBe("mismatched");
  expect(expectData(result).dnsRecord.exists).toBe(true);
  expect(expectData(result).workersRoute.exists).toBe(false);
});

test("errors when CLOUDFLARE_API_TOKEN is missing", async () => {
  createRegistry(tmpDir);
  delete process.env.CLOUDFLARE_API_TOKEN;

  await expect(
    runSubdomainValidate(makeInput({ service: "matomo-proxy" }), makeContext(tmpDir)),
  ).rejects.toThrow("CLOUDFLARE_API_TOKEN is not set");
});
