import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { stringify as yamlStringify } from "yaml";
import { runFleetSitesGenerate, validateFleetSitesDrift } from "./fleet-sites-generate.ts";
import type { KernelRuntimeContext } from "../kernel/types.ts";

function makeContext(workspaceRoot: string): KernelRuntimeContext {
  return {
    workspaceRoot,
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
      event: () => {},
      getEvents: () => [],
    },
    siteName: undefined,
    siteExplicit: false,
    dryRun: false,
    outputFormat: "text",
    io: { write: () => {}, read: () => "" },
    actualState: undefined,
  } as unknown as KernelRuntimeContext;
}

function writeSystemConfig(
  cacheRoot: string,
  id: string,
  opts: { canary?: boolean; status?: string; mirrors?: number } = {},
) {
  const dir = join(cacheRoot, id);
  mkdirSync(dir, { recursive: true });
  const config: Record<string, unknown> = {
    schemaVersion: "1",
    id,
    cosmicStar: "Sirius",
    mirrors: Array.from({ length: opts.mirrors ?? 1 }, (_, i) => ({
      path: i === 0 ? `../systems-cache/${id}` : `git@github.com:example/${id}.git`,
      storageType: i === 0 ? "non-bare" : "bare",
    })),
    pinnedPlatform: "6.0.0",
    status: opts.status ?? "active",
    registeredAt: "2026-01-01T00:00:00Z",
  };
  if (opts.canary) {
    config.fleet = { canary: true };
  }
  writeFileSync(join(dir, "system-config.yaml"), yamlStringify(config));
}

describe("fleet.sites.generate", () => {
  let workspaceRoot: string;
  let cacheRoot: string;

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), "fleet-gen-"));
    cacheRoot = join(workspaceRoot, "..", "systems-cache");
    mkdirSync(cacheRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(cacheRoot, { recursive: true, force: true });
  });

  it("generates fleet.sites.yaml from discovered systems", async () => {
    writeSystemConfig(cacheRoot, "alpha");
    writeSystemConfig(cacheRoot, "beta");

    const result = await runFleetSitesGenerate({ flags: {}, argv: [] }, makeContext(workspaceRoot));

    expect(result.exitCode).toBe(0);
    const data = result.data as { sites: unknown[] };
    expect(data.sites).toHaveLength(2);
    expect(data.sites[0]).toHaveProperty("id");
    expect(data.sites[0]).toHaveProperty("path");
    expect(data.sites[0]).toHaveProperty("platformVersion");
    expect(data.sites[0]).toHaveProperty("channels");
    expect(data.sites[0]).toHaveProperty("mirrors");
    expect(data.sites[0]).toHaveProperty("activeMission");
    expect(data.sites[0]).toHaveProperty("canary");
  });

  it("sorts sites by id", async () => {
    writeSystemConfig(cacheRoot, "zeta");
    writeSystemConfig(cacheRoot, "alpha");

    const result = await runFleetSitesGenerate({ flags: {}, argv: [] }, makeContext(workspaceRoot));
    const data = result.data as { sites: Array<{ id: string }> };
    expect(data.sites[0].id).toBe("alpha");
    expect(data.sites[1].id).toBe("zeta");
  });

  it("sets canary=true when fleet.canary is set in system-config.yaml", async () => {
    writeSystemConfig(cacheRoot, "canary-site", { canary: true });
    writeSystemConfig(cacheRoot, "normal-site", { canary: false });

    const result = await runFleetSitesGenerate({ flags: {}, argv: [] }, makeContext(workspaceRoot));
    const data = result.data as { sites: Array<{ id: string; canary: boolean }> };
    const canary = data.sites.find((s) => s.id === "canary-site");
    const normal = data.sites.find((s) => s.id === "normal-site");
    expect(canary?.canary).toBe(true);
    expect(normal?.canary).toBe(false);
  });

  it("defaults canary to false when fleet field is absent", async () => {
    writeSystemConfig(cacheRoot, "site-a");

    const result = await runFleetSitesGenerate({ flags: {}, argv: [] }, makeContext(workspaceRoot));
    const data = result.data as { sites: Array<{ id: string; canary: boolean }> };
    expect(data.sites[0].canary).toBe(false);
  });

  it("writes the output file with GENERATED header", async () => {
    writeSystemConfig(cacheRoot, "alpha");

    await runFleetSitesGenerate({ flags: {}, argv: [] }, makeContext(workspaceRoot));

    const outputPath = join(workspaceRoot, "fleet", "fleet.sites.yaml");
    expect(existsSync(outputPath)).toBe(true);
    const raw = readFileSync(outputPath, "utf8");
    expect(raw).toContain("GENERATED");
  });

  it("handles empty fleet gracefully", async () => {
    const result = await runFleetSitesGenerate({ flags: {}, argv: [] }, makeContext(workspaceRoot));
    expect(result.exitCode).toBe(0);
    const data = result.data as { sites: unknown[] };
    expect(data.sites).toHaveLength(0);
  });
});

describe("validateFleetSitesDrift", () => {
  let workspaceRoot: string;
  let cacheRoot: string;

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), "fleet-drift-"));
    cacheRoot = join(workspaceRoot, "..", "systems-cache");
    mkdirSync(cacheRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(cacheRoot, { recursive: true, force: true });
  });

  it("reports drift when fleet.sites.yaml does not exist", async () => {
    writeSystemConfig(cacheRoot, "alpha");
    const result = await validateFleetSitesDrift(workspaceRoot);
    expect(result.drifted).toBe(true);
  });

  it("reports no drift after generate", async () => {
    writeSystemConfig(cacheRoot, "alpha");
    await runFleetSitesGenerate({ flags: {}, argv: [] }, makeContext(workspaceRoot));
    const result = await validateFleetSitesDrift(workspaceRoot);
    expect(result.drifted).toBe(false);
  });
});
