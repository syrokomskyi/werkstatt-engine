/*
<MODULE_CONTRACT>
  <purpose>RFC-0925: unit tests for fetchWithRetry authHeaders forwarding via the health adapter method.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0925: initial tests for fetchWithRetry authHeaders forwarding.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, vi } from "vitest";
import { createCloudflareWorkersAdapter } from "./cloudflare-workers.ts";
import type { HealthInput } from "../adapter.ts";
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function makeBehaviorSnapshot(releaseId: string, workspaceRoot: string) {
  const snapshotDir = join(workspaceRoot, "releases", releaseId);
  mkdirSync(snapshotDir, { recursive: true });
  const snapshotPath = join(snapshotDir, "behavior-snapshot.json");
  writeFileSync(
    snapshotPath,
    JSON.stringify({
      routes: [{ path: "/", contentHash: "abc123" }],
    }),
  );
}

test("fetchWithRetry: health method passes authHeaders to fetch for content routes", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "rfc0925-test-"));
  const releaseId = "test-release";
  makeBehaviorSnapshot(releaseId, tmpDir);

  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response("<html><body>OK</body></html>", { status: 200 }));

  const adapter = createCloudflareWorkersAdapter();

  const input: HealthInput = {
    systemId: "test-system",
    channel: "dev",
    deploymentUrl: "https://dev.example.com",
    releaseId,
    expectedBehaviorSnapshotHash: "",
    workspaceRoot: tmpDir,
    authHeaders: { Authorization: "Basic dGVzdDp0ZXN0" },
  };

  await adapter.health(input);

  expect(fetchSpy).toHaveBeenCalled();
  const callArgs = fetchSpy.mock.calls[0];
  const options = callArgs?.[1] as RequestInit | undefined;
  expect(options?.headers).toEqual({ Authorization: "Basic dGVzdDp0ZXN0" });

  fetchSpy.mockRestore();
  rmSync(tmpDir, { recursive: true, force: true });
});

test("fetchWithRetry: health method passes authHeaders to fetch for redirect routes", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "rfc0925-test-"));
  const releaseId = "test-release";
  const snapshotDir = join(tmpDir, "releases", releaseId);
  mkdirSync(snapshotDir, { recursive: true });
  writeFileSync(
    join(snapshotDir, "behavior-snapshot.json"),
    JSON.stringify({
      routes: [{ path: "/de", contentHash: null, redirectTarget: "/" }],
    }),
  );

  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(null, { status: 307, headers: { location: "/" } }));

  const adapter = createCloudflareWorkersAdapter();

  const input: HealthInput = {
    systemId: "test-system",
    channel: "dev",
    deploymentUrl: "https://dev.example.com",
    releaseId,
    expectedBehaviorSnapshotHash: "",
    workspaceRoot: tmpDir,
    authHeaders: { Authorization: "Basic dGVzdDp0ZXN0" },
  };

  await adapter.health(input);

  expect(fetchSpy).toHaveBeenCalled();
  const callArgs = fetchSpy.mock.calls[0];
  const options = callArgs?.[1] as RequestInit | undefined;
  expect(options?.headers).toEqual({ Authorization: "Basic dGVzdDp0ZXN0" });

  fetchSpy.mockRestore();
  rmSync(tmpDir, { recursive: true, force: true });
});

test("fetchWithRetry: health method defaults to empty headers when authHeaders not provided", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "rfc0925-test-"));
  const releaseId = "test-release";
  makeBehaviorSnapshot(releaseId, tmpDir);

  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response("<html><body>OK</body></html>", { status: 200 }));

  const adapter = createCloudflareWorkersAdapter();

  const input: HealthInput = {
    systemId: "test-system",
    channel: "dev",
    deploymentUrl: "https://dev.example.com",
    releaseId,
    expectedBehaviorSnapshotHash: "",
    workspaceRoot: tmpDir,
  };

  await adapter.health(input);

  expect(fetchSpy).toHaveBeenCalled();
  const callArgs = fetchSpy.mock.calls[0];
  const options = callArgs?.[1] as RequestInit | undefined;
  expect(options?.headers).toEqual({});

  fetchSpy.mockRestore();
  rmSync(tmpDir, { recursive: true, force: true });
});

test("fetchWithRetry: 401 response on protected route is reported as unhealthy", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "rfc0925-test-"));
  const releaseId = "test-release";
  makeBehaviorSnapshot(releaseId, tmpDir);

  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response("Unauthorized", { status: 401 }));

  const adapter = createCloudflareWorkersAdapter();

  const input: HealthInput = {
    systemId: "test-system",
    channel: "dev",
    deploymentUrl: "https://dev.example.com",
    releaseId,
    expectedBehaviorSnapshotHash: "",
    workspaceRoot: tmpDir,
    authHeaders: { Authorization: "Basic d3Jvbmc6cGlu" },
  };

  const result = await adapter.health(input);

  expect(result.state).not.toBe("healthy");
  const failedCheck = result.checks.find((c) => !c.passed);
  expect(failedCheck).toBeDefined();
  expect(failedCheck?.detail).toContain("401");
  expect(failedCheck?.detail).not.toContain("Authorization");
  expect(failedCheck?.detail).not.toContain("Basic");

  fetchSpy.mockRestore();
  rmSync(tmpDir, { recursive: true, force: true });
});
