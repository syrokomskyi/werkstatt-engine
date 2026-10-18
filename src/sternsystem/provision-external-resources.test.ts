/*
<MODULE_CONTRACT>
<purpose>RFC-1326 AC-5: provisionExternalResources targets the Vectorize
index ensure at the resolved SITE, not an argv token — the app-scoped
agent.search.index.create resolves sites via options.siteName (fo-review
F-1: a `--site=<id>` inside argv is never consulted, so the handler either
threw "no target site" or read "--site=<id>" as the literal site id).
cloudflare.token.check stays workspace-scoped. A thrown kernel call is
surfaced as a fail result, not an unhandled exception.</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; the kernel executor is mocked at the package boundary.</item>
</non-goals>
<CHANGE_SUMMARY>
  <item>RFC-1326: initial — siteName targeting, workspace token check, throw containment.</item>
  <item>RFC-1326: review-fix pass — siteName targeting for app-scoped provisioning, allow-list completion</item>
</CHANGE_SUMMARY>
*/

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";
import { provisionExternalResources } from "./provision-external-resources.ts";

const executeKernelCommand = vi.fn();

vi.mock("@warpgogol/werkstatt-engine/kernel", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@warpgogol/werkstatt-engine/kernel")>();
  return { ...actual, executeKernelCommand: (...args: unknown[]) => executeKernelCommand(...args) };
});

function context(): KernelRuntimeContext {
  return {
    workspaceRoot: "/tmp/werkstatt-workspace",
    logger: { section() {}, info() {}, warn() {}, error() {}, success() {} },
  } as unknown as KernelRuntimeContext;
}

beforeEach(() => {
  executeKernelCommand.mockReset();
});

describe("provisionExternalResources", () => {
  it("targets agent.search.index.create at the site via siteName, never an argv token", async () => {
    executeKernelCommand.mockResolvedValue({ exitCode: 0, summary: "ok", data: {} });

    const result = await provisionExternalResources(context(), {
      systemId: "dp7",
      missionOpen: true,
    });

    expect(result.ok).toBe(true);
    expect(result.provisioned).toEqual([
      "cloudflare.token.check",
      "agent.search.index.create",
    ]);

    const calls = executeKernelCommand.mock.calls.map(
      (c) => c[0] as Record<string, unknown>,
    );
    expect(calls[0]).toMatchObject({
      commandName: "cloudflare.token.check",
      argv: [],
    });
    expect(calls[0]).not.toHaveProperty("siteName");
    expect(calls[1]).toMatchObject({
      commandName: "agent.search.index.create",
      argv: [],
      siteName: "dp7",
      siteExplicit: true,
    });
    expect(JSON.stringify(calls[1])).not.toContain("--site=");
  });

  it("skips the mutating index ensure when the mission is closed", async () => {
    executeKernelCommand.mockResolvedValue({ exitCode: 0, summary: "ok", data: {} });

    const result = await provisionExternalResources(context(), {
      systemId: "dp7",
      missionOpen: false,
    });

    expect(result.ok).toBe(true);
    expect(executeKernelCommand).toHaveBeenCalledTimes(1);
    expect(executeKernelCommand.mock.calls[0]![0]).toMatchObject({
      commandName: "cloudflare.token.check",
    });
  });

  it("fails with the named permission path when token preflight exits non-zero", async () => {
    executeKernelCommand.mockResolvedValue({
      exitCode: 1,
      summary: "missing: Vectorize → Edit",
      data: {},
    });

    const result = await provisionExternalResources(context(), {
      systemId: "dp7",
      missionOpen: true,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("cloudflare.token.check failed");
    expect(result.error).toContain("Vectorize");
  });

  it("contains a thrown kernel call as a fail result", async () => {
    executeKernelCommand.mockRejectedValue(
      new Error("No target site with a kernel config could be resolved"),
    );

    const result = await provisionExternalResources(context(), {
      systemId: "dp7",
      missionOpen: true,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("No target site");
  });
});
