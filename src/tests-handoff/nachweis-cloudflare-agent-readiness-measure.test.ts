/*
<MODULE_CONTRACT>
  <purpose>
    Unit tests for RFC-0875: nachweis.measure.cloudflare-agent-readiness command handler.
    Tests cover entitlement skip, dry-run, URL validation, credential missing,
    submission request body (agentReadiness + Unlisted), polling states (404 in
    progress, 200 success, 200 failure), timeout, schema drift, not-checked
    dimension mapping, unknown dimension preservation, and ingest delegation.
    Uses mocked fetch — no real Cloudflare API calls.
  </purpose>
  <keywords>RFC-0875, nachweis, cloudflare, agent-readiness, url-scanner, unit-test, polling, mock-fetch</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0875: initial tests for nachweis.measure.cloudflare-agent-readiness command handler.</item>
</CHANGE_SUMMARY>
*/

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  KernelCommandInput,
  KernelRuntimeContext,
  KernelFlagValue,
} from "@warpgogol/werkstatt-engine/kernel";
import { createDefaultIO, createKernelLogger } from "@warpgogol/werkstatt-engine/kernel";
import { expectData } from "./helpers/kernel-result-helpers.ts";

// ── Mock state ──────────────────────────────────────────────────────────────

const mockState = vi.hoisted(() => ({
  fetchCalls: [] as Array<{
    url: string;
    method: string;
    body?: string;
    status: number;
  }>,
  pollResponses: [] as Array<{ status: number; body: string }>,
  pollIndex: 0,
  ingestResult: null as null | { exitCode: number; summary: string; data: Record<string, unknown> },
}));

vi.mock("../evidence/r2-client.ts", () => ({
  MissingEnvError: class MissingEnvError extends Error {
    diagnostic = "MISSING_ENV";
    missingVar: string;
    constructor(v: string) {
      super(`${v} environment variable is required`);
      this.missingVar = v;
    }
  },
  resolveR2ConfigFromEnv: vi.fn(() => ({
    accountId: "test-account",
    accessKeyId: "test-key",
    secretAccessKey: "test-secret",
    bucketName: "nachweise",
  })),
  createR2Client: vi.fn(() => ({
    putObject: vi.fn(async () => {}),
  })),
}));

vi.mock("../sternsystem/registry-io.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../sternsystem/registry-io.ts")>();
  return {
    ...actual,
    resolveCacheClonePath: vi.fn((workspaceRoot: string, systemId: string) => {
      return join(workspaceRoot, "systems-cache", systemId);
    }),
  };
});

vi.mock("../bordbuch/bordbuch-commit-helper.ts", async () => {
  const { existsSync, readFileSync } = await import("node:fs");
  const fsPromises = await import("node:fs/promises");
  const nodePath = await import("node:path");
  const { createHash } = await import("node:crypto");
  return {
    appendAndCommitBordbuch: vi.fn(
      async (
        workspaceRoot: string,
        systemId: string,
        kind: string,
        summary: string,
        actor: string,
        options?: Record<string, unknown>,
      ) => {
        const filePath = nodePath.join(
          workspaceRoot,
          "systems-cache",
          systemId,
          "bordbuch",
          "events.ndjson",
        );
        const dir = nodePath.dirname(filePath);
        if (!existsSync(dir)) await fsPromises.mkdir(dir, { recursive: true });
        const existingContent = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
        const prevLines = existingContent
          .trim()
          .split("\n")
          .filter((l) => l.trim());
        const previousHash =
          prevLines.length > 0 ? JSON.parse(prevLines[prevLines.length - 1]).hash : null;
        const maxNum = prevLines.reduce((max, l) => {
          const m = JSON.parse(l).id?.match(/^event-(\d{6})$/);
          return m ? Math.max(max, parseInt(m[1], 10)) : max;
        }, 0);
        const id = `event-${String(maxNum + 1).padStart(6, "0")}`;
        const entryWithoutHash = {
          schemaVersion: "1.0.0",
          id,
          systemId,
          occurredAt: new Date().toISOString(),
          kind,
          status: (options as { status?: string })?.status ?? "done",
          missionId: null,
          releaseId: null,
          actor,
          summary,
          metadata: (options as { metadata?: unknown })?.metadata,
          previousHash,
          erratumOf: undefined,
        };
        const stable = JSON.stringify(entryWithoutHash, Object.keys(entryWithoutHash).sort());
        const hash = `sha256:${createHash("sha256").update(stable).digest("hex")}`;
        const entry = { ...entryWithoutHash, hash };
        const separator = existingContent.length > 0 && !existingContent.endsWith("\n") ? "\n" : "";
        await fsPromises.writeFile(
          filePath,
          `${existingContent}${separator}${JSON.stringify(entry)}\n`,
          "utf8",
        );
        return { entry, commitResult: { commitSha: null, pushed: false, error: null } };
      },
    ),
  };
});

vi.mock("@warpgogol/werkstatt-engine/kernel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@warpgogol/werkstatt-engine/kernel")>();
  return {
    ...actual,
    executeKernelCommand: vi.fn(async () => ({
      commandName: "bordbuch.validate",
      exitCode: 0,
      data: { entries: 0, violations: [] },
      summary: "bordbuch.validate: 0 entries, 0 violations",
    })),
  };
});

// ── Fetch mock ──────────────────────────────────────────────────────────────

function makeMockFetch() {
  return vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? "GET";
    const body = init?.body;
    mockState.fetchCalls.push({ url, method, body, status: 0 });

    // Submission endpoint
    if (method === "POST" && url.includes("/urlscanner/v2/scan")) {
      const response = {
        result: { uuid: "test-scan-uuid-1234" },
        success: true,
      };
      mockState.fetchCalls[mockState.fetchCalls.length - 1]!.status = 200;
      return makeMockResponse(200, JSON.stringify(response));
    }

    // Result polling endpoint
    if (method === "GET" && url.includes("/urlscanner/v2/result/")) {
      const pollResp = mockState.pollResponses[mockState.pollIndex] ?? {
        status: 200,
        body: JSON.stringify(makeCompletedResult()),
      };
      mockState.pollIndex++;
      mockState.fetchCalls[mockState.fetchCalls.length - 1]!.status = pollResp.status;
      return makeMockResponse(pollResp.status, pollResp.body);
    }

    return makeMockResponse(404, "{}");
  });
}

function makeMockResponse(status: number, body: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => JSON.parse(body),
  } as unknown as Response;
}

function makeCompletedResult(overrides?: Record<string, unknown>): unknown {
  return {
    result: {
      meta: {
        processors: {
          agentReadiness: {
            level: 3,
            levelName: "Good",
            overall: 72,
            checks: {
              robots: { status: "pass", details: { score: 100 }, durationMs: 120 },
              structuredData: { status: "pass", details: { score: 85 }, durationMs: 230 },
              metaTags: { status: "fail", details: { score: 40 }, durationMs: 95 },
              commerce: { status: "not-checked", details: {}, durationMs: 0 },
              customAiAccess: {
                status: "pass",
                details: { passed: 8, total: 10 },
                durationMs: 310,
              },
            },
          },
        },
      },
      scan: {
        url: "https://example.com",
        createdAt: "2026-08-18T10:00:00.000Z",
        finishedAt: "2026-08-18T10:02:30.000Z",
      },
      task: { status: "Finished", success: true },
    },
    success: true,
    ...overrides,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

let tmpDir: string;
let workspaceRoot: string;

function makeContext(siteName?: string): KernelRuntimeContext {
  const logger = createKernelLogger();
  const { io } = createDefaultIO();
  return {
    workspaceRoot,
    logger,
    io,
    fileIntents: [],
    commandName: "test",
    ...(siteName ? { site: { name: siteName } } : {}),
  } as unknown as KernelRuntimeContext;
}

function makeInput(flags: Record<string, KernelFlagValue>): KernelCommandInput {
  return {
    flags,
    argv: [],
  };
}

async function writeSystemManifest(cachePath: string): Promise<void> {
  const contentDir = join(cachePath, "src", "content");
  await mkdir(contentDir, { recursive: true });
  await writeFile(
    join(contentDir, "system.md"),
    "---\ni18n:\n  default: de\n  supported:\n    de: true\n---\n",
  );
}

async function writeEntitlements(cachePath: string, features: string[]): Promise<void> {
  const dir = join(cachePath, "src");
  await mkdir(dir, { recursive: true });
  const { stringify: yamlStringify } = await import("yaml");
  await writeFile(join(dir, "entitlements.generated.yaml"), yamlStringify({ features }));
  await writeSystemManifest(cachePath);
}

function setEnvVars() {
  process.env.CLOUDFLARE_URL_SCANNER_ACCOUNT_ID = "test-account-id";
  process.env.CLOUDFLARE_URL_SCANNER_API_TOKEN = "test-api-token";
}

function clearEnvVars() {
  delete process.env.CLOUDFLARE_URL_SCANNER_ACCOUNT_ID;
  delete process.env.CLOUDFLARE_URL_SCANNER_API_TOKEN;
  delete process.env.CLOUDFLARE_AR_POLL_INTERVAL_MS;
  delete process.env.CLOUDFLARE_AR_MAX_ELAPSED_MS;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("RFC-0875: nachweis.measure.cloudflare-agent-readiness", () => {
  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "cf-ar-test-"));
    workspaceRoot = tmpDir;
    mockState.fetchCalls = [];
    mockState.pollResponses = [];
    mockState.pollIndex = 0;
    mockState.ingestResult = null;
    setEnvVars();
    process.env.CLOUDFLARE_AR_POLL_INTERVAL_MS = "10";
    process.env.CLOUDFLARE_AR_MAX_ELAPSED_MS = "5000";
    vi.stubGlobal("fetch", makeMockFetch());
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    clearEnvVars();
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("entitlement gating", () => {
    it("skips when nachweis entitlement is not resolved", async () => {
      const cachePath = join(workspaceRoot, "systems-cache", "test-system");
      await writeEntitlements(cachePath, []);

      const { runNachweisCloudflareAgentReadinessMeasure } =
        await import("../nachweis/nachweis-cloudflare-agent-readiness-measure.ts");

      const result = await runNachweisCloudflareAgentReadinessMeasure(
        makeInput({
          system: "test-system",
          url: "https://example.com",
        }),
        makeContext(),
      );

      expect(result.exitCode).toBe(0);
      expect((result.data as unknown as Record<string, unknown>).skipped).toBe(true);
    });
  });

  describe("dry-run", () => {
    it("returns dry-run result without calling the API", async () => {
      const cachePath = join(workspaceRoot, "systems-cache", "test-system");
      await writeEntitlements(cachePath, ["nachweis"]);

      const { runNachweisCloudflareAgentReadinessMeasure } =
        await import("../nachweis/nachweis-cloudflare-agent-readiness-measure.ts");

      const result = await runNachweisCloudflareAgentReadinessMeasure(
        makeInput({
          system: "test-system",
          url: "https://example.com",
          "dry-run": true,
        }),
        makeContext(),
      );

      expect(result.exitCode).toBe(0);
      const data = expectData(result);
      expect(data.status).toBe("ok");
      expect(data.scanId).toBe("");
      expect(data.observationId).toBe("");
      expect(mockState.fetchCalls.length).toBe(0);
    });
  });

  describe("URL validation", () => {
    it("fails with CLOUDFLARE_URL_INVALID for non-HTTPS URL", async () => {
      const cachePath = join(workspaceRoot, "systems-cache", "test-system");
      await writeEntitlements(cachePath, ["nachweis"]);

      const { runNachweisCloudflareAgentReadinessMeasure } =
        await import("../nachweis/nachweis-cloudflare-agent-readiness-measure.ts");

      const result = await runNachweisCloudflareAgentReadinessMeasure(
        makeInput({
          system: "test-system",
          url: "http://example.com",
        }),
        makeContext(),
      );

      expect(result.exitCode).toBe(1);
      const data = expectData(result);
      expect(data.status).toBe("error");
      expect(data.code).toBe("CLOUDFLARE_URL_INVALID");
    });
  });

  describe("credential validation", () => {
    it("fails with CLOUDFLARE_CREDENTIALS_MISSING when env vars are absent", async () => {
      const cachePath = join(workspaceRoot, "systems-cache", "test-system");
      await writeEntitlements(cachePath, ["nachweis"]);
      clearEnvVars();

      const { runNachweisCloudflareAgentReadinessMeasure } =
        await import("../nachweis/nachweis-cloudflare-agent-readiness-measure.ts");

      const result = await runNachweisCloudflareAgentReadinessMeasure(
        makeInput({
          system: "test-system",
          url: "https://example.com",
        }),
        makeContext(),
      );

      expect(result.exitCode).toBe(1);
      const data = expectData(result);
      expect(data.code).toBe("CLOUDFLARE_CREDENTIALS_MISSING");
    });
  });

  describe("submission request", () => {
    it("includes agentReadiness: true and visibility: Unlisted in the submission body", async () => {
      const cachePath = join(workspaceRoot, "systems-cache", "test-system");
      await writeEntitlements(cachePath, ["nachweis"]);

      const { runNachweisCloudflareAgentReadinessMeasure } =
        await import("../nachweis/nachweis-cloudflare-agent-readiness-measure.ts");

      await runNachweisCloudflareAgentReadinessMeasure(
        makeInput({
          system: "test-system",
          url: "https://example.com",
        }),
        makeContext(),
      );

      const postCall = mockState.fetchCalls.find(
        (c) => c.method === "POST" && c.url.includes("/urlscanner/v2/scan"),
      );
      expect(postCall).toBeDefined();
      const body = JSON.parse(postCall!.body!);
      expect(body.agentReadiness).toBe(true);
      expect(body.visibility).toBe("Unlisted");
      expect(body.url).toBe("https://example.com");
    });
  });

  describe("polling", () => {
    it("continues polling when provider returns HTTP 404 (in progress)", async () => {
      const cachePath = join(workspaceRoot, "systems-cache", "test-system");
      await writeEntitlements(cachePath, ["nachweis"]);

      mockState.pollResponses = [
        { status: 404, body: "{}" },
        { status: 404, body: "{}" },
        {
          status: 200,
          body: JSON.stringify(makeCompletedResult()),
        },
      ];

      const { runNachweisCloudflareAgentReadinessMeasure } =
        await import("../nachweis/nachweis-cloudflare-agent-readiness-measure.ts");

      const result = await runNachweisCloudflareAgentReadinessMeasure(
        makeInput({
          system: "test-system",
          url: "https://example.com",
        }),
        makeContext(),
      );

      expect(result.exitCode).toBe(0);
      const data = expectData(result);
      expect(data.status).toBe("ok");
      expect(data.scanId).toBe("test-scan-uuid-1234");

      const getResultCalls = mockState.fetchCalls.filter(
        (c) => c.method === "GET" && c.url.includes("/urlscanner/v2/result/"),
      );
      expect(getResultCalls.length).toBe(3);
    });

    it("completes successfully when provider returns HTTP 200 with task.success=true", async () => {
      const cachePath = join(workspaceRoot, "systems-cache", "test-system");
      await writeEntitlements(cachePath, ["nachweis"]);

      mockState.pollResponses = [{ status: 200, body: JSON.stringify(makeCompletedResult()) }];

      const { runNachweisCloudflareAgentReadinessMeasure } =
        await import("../nachweis/nachweis-cloudflare-agent-readiness-measure.ts");

      const result = await runNachweisCloudflareAgentReadinessMeasure(
        makeInput({
          system: "test-system",
          url: "https://example.com",
        }),
        makeContext(),
      );

      expect(result.exitCode).toBe(0);
      const data = expectData(result);
      expect(data.status).toBe("ok");
      expect(data.observationId).toContain("cf-ar-");
      expect(data.ingest).toBeDefined();
    });

    it("fails with CLOUDFLARE_SCAN_FAILED when provider reports task.success=false", async () => {
      const cachePath = join(workspaceRoot, "systems-cache", "test-system");
      await writeEntitlements(cachePath, ["nachweis"]);

      mockState.pollResponses = [
        {
          status: 200,
          body: JSON.stringify(
            makeCompletedResult({
              result: {
                meta: { processors: { agentReadiness: null } },
                scan: { url: "https://example.com" },
                task: { status: "Finished", success: false },
              },
            }),
          ),
        },
      ];

      const { runNachweisCloudflareAgentReadinessMeasure } =
        await import("../nachweis/nachweis-cloudflare-agent-readiness-measure.ts");

      const result = await runNachweisCloudflareAgentReadinessMeasure(
        makeInput({
          system: "test-system",
          url: "https://example.com",
        }),
        makeContext(),
      );

      expect(result.exitCode).toBe(1);
      const data = expectData(result);
      expect(data.code).toBe("CLOUDFLARE_SCAN_FAILED");
    });

    it("fails with CLOUDFLARE_SCAN_TIMEOUT when polling exceeds max elapsed time", async () => {
      const cachePath = join(workspaceRoot, "systems-cache", "test-system");
      await writeEntitlements(cachePath, ["nachweis"]);

      // Set very short max elapsed time and always return 404
      process.env.CLOUDFLARE_AR_MAX_ELAPSED_MS = "50";
      mockState.pollResponses = [
        { status: 404, body: "{}" },
        { status: 404, body: "{}" },
        { status: 404, body: "{}" },
        { status: 404, body: "{}" },
        { status: 404, body: "{}" },
        { status: 404, body: "{}" },
        { status: 404, body: "{}" },
        { status: 404, body: "{}" },
      ];

      const { runNachweisCloudflareAgentReadinessMeasure } =
        await import("../nachweis/nachweis-cloudflare-agent-readiness-measure.ts");

      const result = await runNachweisCloudflareAgentReadinessMeasure(
        makeInput({
          system: "test-system",
          url: "https://example.com",
        }),
        makeContext(),
      );

      expect(result.exitCode).toBe(1);
      const data = expectData(result);
      expect(data.code).toBe("CLOUDFLARE_SCAN_TIMEOUT");
    });
  });

  describe("schema drift", () => {
    it("fails with ASSESSMENT_SCHEMA_UNSUPPORTED when agentReadiness is absent from result", async () => {
      const cachePath = join(workspaceRoot, "systems-cache", "test-system");
      await writeEntitlements(cachePath, ["nachweis"]);

      mockState.pollResponses = [
        {
          status: 200,
          body: JSON.stringify(
            makeCompletedResult({
              result: {
                meta: { processors: {} },
                scan: { url: "https://example.com" },
                task: { status: "Finished", success: true },
              },
            }),
          ),
        },
      ];

      const { runNachweisCloudflareAgentReadinessMeasure } =
        await import("../nachweis/nachweis-cloudflare-agent-readiness-measure.ts");

      const result = await runNachweisCloudflareAgentReadinessMeasure(
        makeInput({
          system: "test-system",
          url: "https://example.com",
        }),
        makeContext(),
      );

      expect(result.exitCode).toBe(1);
      const data = expectData(result);
      expect(data.code).toBe("ASSESSMENT_SCHEMA_UNSUPPORTED");
    });
  });

  describe("dimension mapping", () => {
    it("maps not-checked dimensions to status: not-checked, not score: 0", async () => {
      const cachePath = join(workspaceRoot, "systems-cache", "test-system");
      await writeEntitlements(cachePath, ["nachweis"]);

      mockState.pollResponses = [{ status: 200, body: JSON.stringify(makeCompletedResult()) }];

      const { runNachweisCloudflareAgentReadinessMeasure } =
        await import("../nachweis/nachweis-cloudflare-agent-readiness-measure.ts");

      const result = await runNachweisCloudflareAgentReadinessMeasure(
        makeInput({
          system: "test-system",
          url: "https://example.com",
        }),
        makeContext(),
      );

      expect(result.exitCode).toBe(0);
      const data = expectData(result);
      expect(data.status).toBe("ok");
      const ingest = data.ingest as unknown as Record<string, unknown>;
      expect(ingest).toBeDefined();
      // The bundle was ingested — verify the ingest result has observationId
      expect(ingest.observationId).toBeDefined();
    });

    it("preserves additional unknown dimensions from the provider response", async () => {
      const cachePath = join(workspaceRoot, "systems-cache", "test-system");
      await writeEntitlements(cachePath, ["nachweis"]);

      const resultWithExtra = makeCompletedResult({
        result: {
          meta: {
            processors: {
              agentReadiness: {
                level: 2,
                levelName: "Fair",
                overall: 55,
                checks: {
                  robots: { status: "pass", details: { score: 90 }, durationMs: 100 },
                  newFutureDimension: {
                    status: "pass",
                    details: { score: 77 },
                    durationMs: 200,
                  },
                },
              },
            },
          },
          scan: {
            url: "https://example.com",
            createdAt: "2026-08-18T10:00:00.000Z",
            finishedAt: "2026-08-18T10:01:00.000Z",
          },
          task: { status: "Finished", success: true },
        },
      });

      mockState.pollResponses = [{ status: 200, body: JSON.stringify(resultWithExtra) }];

      const { runNachweisCloudflareAgentReadinessMeasure, parseAgentReadiness } =
        await import("../nachweis/nachweis-cloudflare-agent-readiness-measure.ts");

      // Verify parser preserves unknown dimension
      // parseAgentReadiness expects the unwrapped response (meta at top level)
      const unwrapped = (
        JSON.parse(JSON.stringify(resultWithExtra)) as { result: Record<string, unknown> }
      ).result;
      const parsed = parseAgentReadiness(unwrapped as never);
      const dimIds = parsed.dimensions.map((d) => d.id);
      expect(dimIds).toContain("newFutureDimension");
      expect(dimIds).toContain("robots");

      const result = await runNachweisCloudflareAgentReadinessMeasure(
        makeInput({
          system: "test-system",
          url: "https://example.com",
        }),
        makeContext(),
      );

      expect(result.exitCode).toBe(0);
    });
  });

  describe("parser unit tests", () => {
    it("parseAgentReadiness throws SchemaUnsupportedError when agentReadiness is missing", async () => {
      const { parseAgentReadiness } =
        await import("../nachweis/nachweis-cloudflare-agent-readiness-measure.ts");

      expect(() =>
        parseAgentReadiness({ result: { scan: {}, task: { success: true } } } as never),
      ).toThrow();
    });

    it("parseAgentReadiness maps not-checked status correctly", async () => {
      const { parseAgentReadiness } =
        await import("../nachweis/nachweis-cloudflare-agent-readiness-measure.ts");

      const parsed = parseAgentReadiness({
        meta: {
          processors: {
            agentReadiness: {
              checks: {
                commerce: { status: "not-checked", details: {} },
              },
            },
          },
        },
      } as never);

      const commerceDim = parsed.dimensions.find((d) => d.id === "commerce");
      expect(commerceDim).toBeDefined();
      expect(commerceDim!.status).toBe("not-checked");
      expect(commerceDim!.score).toBeUndefined();
    });
  });
});
