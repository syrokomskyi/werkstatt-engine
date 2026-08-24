/*
<MODULE_CONTRACT>
<purpose>RFC-0379: cloudflare-workers adapter tests — verify wrangler invocation, exit code handling, health verdict mapping, secret redaction.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0379: initial adapter tests with stubbed CommandRunner.</item>
  <item>RFC-0623: add retry behavior tests (transient 5xx retry, auth error no-retry, success after retry, retries exhausted, rollback retry).</item>
  <item>ADR-0027: add sourceDotenv empty-value skip tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  createCloudflareWorkersAdapter,
  sourceDotenv,
} from "../leitstand/adapters/cloudflare-workers.ts";
import type { CommandRunner } from "../leitstand/adapter.ts";

// RFC-0895: rollback uses runWranglerRollback (native spawn) instead of the
// injected runner. Mock it so tests don't spawn real wrangler processes.
vi.mock("../leitstand/service-deploy-helpers.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("../leitstand/service-deploy-helpers.ts")>();
  return {
    ...original,
    runWranglerRollback: vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" })),
  };
});

function stubRunner(exitCode: number, stdout: string, stderr: string = ""): CommandRunner {
  return vi.fn(async () => ({ exitCode, stdout, stderr })) as unknown as CommandRunner;
}

function optsCapturingRunner(exitCode: number, stdout: string): CommandRunner {
  return vi.fn(
    async (
      _cmd: string,
      _args: string[],
      opts?: { cwd?: string; env?: Record<string, string> },
    ) => ({
      exitCode,
      stdout,
      stderr: "",
      opts,
    }),
  ) as unknown as CommandRunner;
}

const basePropagateInput = {
  systemId: "test-system",
  releaseId: "test-system-r000001",
  channel: "alt" as const,
  distPath: "/tmp/dist",
  workerName: "alt-test-system",
  url: "https://alt.test.example.com",
  secretsFilePath: undefined as string | undefined,
  expectedBehaviorSnapshotHash: "",
};

test("adapter: propagate succeeds when wrangler exits 0", async () => {
  const runner = stubRunner(0, "Deployed to https://alt.test.example.com");
  const adapter = createCloudflareWorkersAdapter(runner);
  const result = await adapter.propagate(basePropagateInput);
  expect(result.state).toBe("succeeded");
  expect(result.deploymentUrl).toBe("https://alt.test.example.com");
});

test("adapter: propagate fails when wrangler exits non-zero", async () => {
  const runner = stubRunner(1, "", "wrangler error");
  const adapter = createCloudflareWorkersAdapter(runner);
  const result = await adapter.propagate(basePropagateInput);
  expect(result.state).toBe("failed");
});

test("adapter: rollback succeeds when wrangler exits 0", async () => {
  const { runWranglerRollback } = await import("../leitstand/service-deploy-helpers.ts");
  vi.mocked(runWranglerRollback).mockResolvedValueOnce({
    exitCode: 0,
    stdout: "Rollback complete",
    stderr: "",
  });
  const adapter = createCloudflareWorkersAdapter(stubRunner(0, ""));
  const result = await adapter.rollback({
    systemId: "test-system",
    channel: "main",
    wranglerConfigDir: "/tmp",
    workerName: "test-system",
  });
  expect(result.state).toBe("succeeded");
});

test("adapter: health returns unknown when no behavior snapshot routes", async () => {
  const adapter = createCloudflareWorkersAdapter(stubRunner(0, ""));
  const result = await adapter.health({
    systemId: "test-system",
    channel: "alt",
    deploymentUrl: "https://alt.test.example.com",
    releaseId: "nonexistent-release",
    expectedBehaviorSnapshotHash: "",
    workspaceRoot: "/tmp",
  });
  expect(result.state).toBe("unknown");
  expect(result.checks).toHaveLength(1);
});

test("adapter: name is cloudflare-workers", () => {
  const adapter = createCloudflareWorkersAdapter(stubRunner(0, ""));
  expect(adapter.name).toBe("cloudflare-workers");
});

test("adapter: secret values never appear in propagation result", async () => {
  process.env.TEST_SECRET_VALUE = "super-secret-123";
  const runner = stubRunner(0, "Deployed to https://alt.test.example.com");
  const adapter = createCloudflareWorkersAdapter(runner);
  const result = await adapter.propagate({
    ...basePropagateInput,
    secretsFilePath: undefined,
  });
  const serialized = JSON.stringify(result);
  expect(serialized).not.toContain("super-secret-123");
  delete process.env.TEST_SECRET_VALUE;
});

test("adapter: propagate passes dotenv vars via opts.env when secretsFilePath is set", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wg-test-"));
  const envFile = path.join(tmpDir, ".env");
  await fs.writeFile(envFile, "CLOUDFLARE_API_TOKEN=test-token-from-dotenv\n");

  const runner = optsCapturingRunner(0, "Deployed to https://alt.test.example.com");
  const adapter = createCloudflareWorkersAdapter(runner);
  await adapter.propagate({
    ...basePropagateInput,
    secretsFilePath: envFile,
  });

  const calls = (runner as unknown as ReturnType<typeof vi.fn>).mock.calls;
  const lastCall = calls[calls.length - 1];
  const opts = (lastCall[2] as { env?: Record<string, string> } | undefined)?.env;
  expect(opts?.CLOUDFLARE_API_TOKEN).toBe("test-token-from-dotenv");

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("RFC-0618: health check route probe URLs do NOT include cache-buster query param", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wg-test-cb-"));
  const releaseId = "test-system-r000001";
  const snapshotDir = path.join(tmpDir, "releases", releaseId);
  await fs.mkdir(snapshotDir, { recursive: true });
  await fs.writeFile(
    path.join(snapshotDir, "behavior-snapshot.json"),
    JSON.stringify({
      schemaVersion: "1.0.0",
      releaseId,
      capturedAt: "2026-01-01T00:00:00.000Z",
      routes: [
        { path: "/", contentHash: null },
        { path: "/de", contentHash: null },
      ],
    }),
  );

  const mockFetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => "<html></html>",
    headers: new Headers(),
  });
  vi.stubGlobal("fetch", mockFetch);

  const adapter = createCloudflareWorkersAdapter(stubRunner(0, ""));
  await adapter.health({
    systemId: "test-system",
    channel: "alt",
    deploymentUrl: "https://alt.example.com",
    releaseId,
    expectedBehaviorSnapshotHash: "",
    workspaceRoot: tmpDir,
  });

  expect(mockFetch.mock.calls.length).toBeGreaterThan(0);
  for (const call of mockFetch.mock.calls) {
    const url = call[0] as string;
    expect(url).not.toContain("?cb=");
  }

  vi.unstubAllGlobals();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function statefulRunner(
  results: Array<{ exitCode: number; stdout: string; stderr: string }>,
): CommandRunner {
  let callIndex = 0;
  return vi.fn(async () => {
    const result = results[Math.min(callIndex, results.length - 1)];
    callIndex++;
    return result;
  }) as unknown as CommandRunner;
}

test("RFC-0623: propagate retries on transient 504 Gateway Timeout then succeeds", async () => {
  vi.useFakeTimers();
  const runner = statefulRunner([
    { exitCode: 1, stdout: "", stderr: "Error: 504 Gateway Timeout" },
    { exitCode: 0, stdout: "Deployed to https://alt.test.example.com", stderr: "" },
  ]);
  const adapter = createCloudflareWorkersAdapter(runner);
  const promise = adapter.propagate(basePropagateInput);
  await vi.advanceTimersByTimeAsync(30_000);
  const result = await promise;
  expect(result.state).toBe("succeeded");
  expect((runner as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  vi.useRealTimers();
});

test("RFC-0623: propagate does NOT retry on authentication error", async () => {
  const runner = statefulRunner([
    { exitCode: 1, stdout: "", stderr: "Authentication error: invalid API token" },
  ]);
  const adapter = createCloudflareWorkersAdapter(runner);
  const result = await adapter.propagate(basePropagateInput);
  expect(result.state).toBe("failed");
  expect((runner as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
});

test("RFC-0623: propagate succeeds after retry on 522 error", async () => {
  vi.useFakeTimers();
  const runner = statefulRunner([
    { exitCode: 1, stdout: "", stderr: "Error: 522 Connection timed out" },
    { exitCode: 0, stdout: "Deployed to https://alt.test.example.com", stderr: "" },
  ]);
  const adapter = createCloudflareWorkersAdapter(runner);
  const promise = adapter.propagate(basePropagateInput);
  await vi.advanceTimersByTimeAsync(30_000);
  const result = await promise;
  expect(result.state).toBe("succeeded");
  expect((runner as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  vi.useRealTimers();
});

test("RFC-0623: propagate exhausts all retries on persistent 503 then fails", async () => {
  vi.useFakeTimers();
  const runner = statefulRunner([
    { exitCode: 1, stdout: "", stderr: "Error: 503 Service Unavailable" },
    { exitCode: 1, stdout: "", stderr: "Error: 503 Service Unavailable" },
    { exitCode: 1, stdout: "", stderr: "Error: 503 Service Unavailable" },
  ]);
  const adapter = createCloudflareWorkersAdapter(runner);
  const promise = adapter.propagate(basePropagateInput);
  await vi.advanceTimersByTimeAsync(30_000);
  await vi.advanceTimersByTimeAsync(60_000);
  const result = await promise;
  expect(result.state).toBe("failed");
  expect((runner as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(3);
  vi.useRealTimers();
});

test("RFC-0623: propagate does NOT retry on syntax error", async () => {
  const runner = statefulRunner([
    { exitCode: 1, stdout: "", stderr: "SyntaxError: Unexpected token in wrangler.toml" },
  ]);
  const adapter = createCloudflareWorkersAdapter(runner);
  const result = await adapter.propagate(basePropagateInput);
  expect(result.state).toBe("failed");
  expect((runner as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
});

// RFC-0895: rollback no longer retries — it uses native wrangler rollback
// which is a single atomic operation. The retry-on-transient-error test was
// removed because the old deploy-based rollback path is gone.

test("ADR-0027: sourceDotenv skips entries with empty values", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wg-test-adr27-"));
  const envFile = path.join(tmpDir, ".env");
  await fs.writeFile(
    envFile,
    [
      "CLOUDFLARE_ZONE_ID=",
      "CLOUDFLARE_API_TOKEN=real-token",
      "EMPTY_QUOTED=''",
      'EMPTY_DOUBLE_QUOTED=""',
      "# COMMENT_KEY=should-not-appear",
      "ANOTHER_EMPTY=",
      "REAL_VALUE=hello",
    ].join("\n") + "\n",
  );

  const result = await sourceDotenv(envFile);

  expect(result["CLOUDFLARE_API_TOKEN"]).toBe("real-token");
  expect(result["REAL_VALUE"]).toBe("hello");
  expect(result).not.toHaveProperty("CLOUDFLARE_ZONE_ID");
  expect(result).not.toHaveProperty("EMPTY_QUOTED");
  expect(result).not.toHaveProperty("EMPTY_DOUBLE_QUOTED");
  expect(result).not.toHaveProperty("ANOTHER_EMPTY");
  expect(result).not.toHaveProperty("COMMENT_KEY");

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("ADR-0027: sourceDotenv empty-value skip allows process.env fallback in merge order", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wg-test-adr27-merge-"));
  const envFile = path.join(tmpDir, ".env");
  await fs.writeFile(envFile, "CLOUDFLARE_ZONE_ID=\nCLOUDFLARE_API_TOKEN=from-dotenv\n");

  const originalZoneId = process.env.CLOUDFLARE_ZONE_ID;
  process.env.CLOUDFLARE_ZONE_ID = "from-process-env";

  const secretsEnv = await sourceDotenv(envFile);
  const { filterEnv } = await import("../leitstand/adapters/cloudflare-workers.ts");
  const merged = { ...filterEnv(process.env), ...secretsEnv };

  expect(merged["CLOUDFLARE_ZONE_ID"]).toBe("from-process-env");
  expect(merged["CLOUDFLARE_API_TOKEN"]).toBe("from-dotenv");

  if (originalZoneId !== undefined) {
    process.env.CLOUDFLARE_ZONE_ID = originalZoneId;
  } else {
    delete process.env.CLOUDFLARE_ZONE_ID;
  }
  await fs.rm(tmpDir, { recursive: true, force: true });
});
