/*
<MODULE_CONTRACT>
<purpose>RFC-0896: tests for customdomain.register command handler — idempotency, new registration, mismatched records, missing env, missing zone ID.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0896: initial customdomain.register tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCustomdomainRegister } from "../customdomain/customdomain-register.ts";
import type { KernelRuntimeContext, KernelCommandInput } from "@warpgogol/werkstatt-engine/kernel";
import { setupCloudflareApiMock, cfSuccessResponse } from "./helpers/cloudflare-api-mock.ts";
import { buildSystemConfig } from "./helpers/registry-builder.ts";
import { expectData } from "./helpers/kernel-result-helpers.ts";

let tmpDir: string;
let parentDir: string;
let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  parentDir = mkdtempSync(join(tmpdir(), "tmp-customdomain-register-"));
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

test("registers new A record and Workers route when none exist", async () => {
  createSystemConfig(tmpDir);

  let createdDns = false;
  let createdRoute = false;

  setupCloudflareApiMock(mockFetch, {
    createDns: () => {
      createdDns = true;
      return cfSuccessResponse({
        id: "dns-new",
        type: "A",
        name: "warpgogol.com",
        content: "192.0.2.1",
        proxied: true,
      });
    },
    createRoute: () => {
      createdRoute = true;
      return cfSuccessResponse({
        id: "route-new",
        pattern: "warpgogol.com/*",
        script: "warpgogol-com",
      });
    },
  });

  const result = await runCustomdomainRegister(
    makeInput({ site: "warpgogol-com" }),
    makeContext(tmpDir),
  );
  const data = expectData(result);

  expect(data.state).toBe("registered");
  expect(data.dnsRecord.created).toBe(true);
  expect(data.dnsRecord.id).toBe("dns-new");
  expect(data.dnsRecord.type).toBe("A");
  expect(data.workersRoute.created).toBe(true);
  expect(data.workersRoute.id).toBe("route-new");
  expect(data.workersRoute.pattern).toBe("warpgogol.com/*");
  expect(data.workersRoute.script).toBe("warpgogol-com");
  expect(createdDns).toBe(true);
  expect(createdRoute).toBe(true);
});

test("is idempotent — skips creation when A record and route already correct", async () => {
  createSystemConfig(tmpDir);

  let createdDns = false;
  let createdRoute = false;

  setupCloudflareApiMock(mockFetch, {
    dnsList: () =>
      cfSuccessResponse([
        {
          id: "dns-existing",
          type: "A",
          name: "warpgogol.com",
          content: "192.0.2.1",
          proxied: true,
        },
      ]),
    routeList: () =>
      cfSuccessResponse([
        {
          id: "route-existing",
          pattern: "warpgogol.com/*",
          script: "warpgogol-com",
        },
      ]),
    createDns: () => {
      createdDns = true;
      return cfSuccessResponse({});
    },
    createRoute: () => {
      createdRoute = true;
      return cfSuccessResponse({});
    },
  });

  const result = await runCustomdomainRegister(
    makeInput({ site: "warpgogol-com" }),
    makeContext(tmpDir),
  );
  const data = expectData(result);

  expect(data.state).toBe("already-registered");
  expect(data.dnsRecord.created).toBe(false);
  expect(data.dnsRecord.id).toBe("dns-existing");
  expect(data.workersRoute.created).toBe(false);
  expect(createdDns).toBe(false);
  expect(createdRoute).toBe(false);
});

test("creates A record when only non-A records (MX/TXT) exist for the same domain", async () => {
  createSystemConfig(tmpDir);

  let createdDns = false;
  let createdRoute = false;

  setupCloudflareApiMock(mockFetch, {
    dnsList: () =>
      cfSuccessResponse([
        {
          id: "dns-mx",
          type: "MX",
          name: "warpgogol.com",
          content: "route3.mx.cloudflare.net",
          proxied: false,
          priority: 10,
        },
        {
          id: "dns-txt",
          type: "TXT",
          name: "warpgogol.com",
          content: "v=spf1 include:_spf.mx.cloudflare.net ~all",
          proxied: false,
        },
      ]),
    createDns: () => {
      createdDns = true;
      return cfSuccessResponse({
        id: "dns-new",
        type: "A",
        name: "warpgogol.com",
        content: "192.0.2.1",
        proxied: true,
      });
    },
    createRoute: () => {
      createdRoute = true;
      return cfSuccessResponse({
        id: "route-new",
        pattern: "warpgogol.com/*",
        script: "warpgogol-com",
      });
    },
  });

  const result = await runCustomdomainRegister(
    makeInput({ site: "warpgogol-com" }),
    makeContext(tmpDir),
  );
  const data = expectData(result);

  expect(data.state).toBe("registered");
  expect(data.dnsRecord.created).toBe(true);
  expect(data.dnsRecord.id).toBe("dns-new");
  expect(data.dnsRecord.type).toBe("A");
  expect(data.workersRoute.created).toBe(true);
  expect(createdDns).toBe(true);
  expect(createdRoute).toBe(true);
});

test("errors when A record exists but is not proxied", async () => {
  createSystemConfig(tmpDir);

  setupCloudflareApiMock(mockFetch, {
    dnsList: () =>
      cfSuccessResponse([
        {
          id: "dns-a-unproxied",
          type: "A",
          name: "warpgogol.com",
          content: "192.0.2.1",
          proxied: false,
        },
      ]),
  });

  await expect(
    runCustomdomainRegister(makeInput({ site: "warpgogol-com" }), makeContext(tmpDir)),
  ).rejects.toThrow("A record for 'warpgogol.com' exists but is not proxied");
});

test("errors when Workers route exists with wrong script", async () => {
  createSystemConfig(tmpDir);

  setupCloudflareApiMock(mockFetch, {
    dnsList: () =>
      cfSuccessResponse([
        {
          id: "dns-ok",
          type: "A",
          name: "warpgogol.com",
          content: "192.0.2.1",
          proxied: true,
        },
      ]),
    routeList: () =>
      cfSuccessResponse([
        {
          id: "route-wrong",
          pattern: "warpgogol.com/*",
          script: "wrong-worker",
        },
      ]),
  });

  await expect(
    runCustomdomainRegister(makeInput({ site: "warpgogol-com" }), makeContext(tmpDir)),
  ).rejects.toThrow("Workers route for 'warpgogol.com/*' exists but points to wrong script");
});

test("errors when CLOUDFLARE_API_TOKEN is missing", async () => {
  createSystemConfig(tmpDir);
  delete process.env.CLOUDFLARE_API_TOKEN;

  await expect(
    runCustomdomainRegister(makeInput({ site: "warpgogol-com" }), makeContext(tmpDir)),
  ).rejects.toThrow("CLOUDFLARE_API_TOKEN is required");
});

test("errors when cloudflareZoneId is missing from system config", async () => {
  createSystemConfig(tmpDir, { withZoneId: false });

  await expect(
    runCustomdomainRegister(makeInput({ site: "warpgogol-com" }), makeContext(tmpDir)),
  ).rejects.toThrow("cloudflareZoneId");
});

test("errors when --site is missing", async () => {
  createSystemConfig(tmpDir);

  await expect(runCustomdomainRegister(makeInput({}), makeContext(tmpDir))).rejects.toThrow(
    "--site is required",
  );
});
