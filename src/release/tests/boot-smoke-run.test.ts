// @vitest-environment node
import { describe, it, expect } from "vitest";
import { resolveWranglerConfig, resolveLanguages } from "../boot-smoke.ts";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("resolveWranglerConfig", () => {
  it("uses --wrangler-config flag when provided", () => {
    const tmpDist = mkdtempSync(join(tmpdir(), "boot-smoke-wflag-"));
    const customConfig = join(tmpDist, "custom-wrangler.jsonc");
    writeFileSync(customConfig, "{}");
    const result = resolveWranglerConfig(tmpDist, customConfig, "/fake/workspace");
    expect(result).not.toBeNull();
    expect(result!.wranglerConfigPath).toBe(customConfig);
    expect(result!.bootSmokeDistDir).toBe(tmpDist);
  });

  it("defaults to dist/server/wrangler.json when Astro output exists", () => {
    const tmpDist = mkdtempSync(join(tmpdir(), "boot-smoke-astro-"));
    mkdirSync(join(tmpDist, "server"), { recursive: true });
    const astroWrangler = join(tmpDist, "server", "wrangler.json");
    writeFileSync(astroWrangler, "{}");
    const result = resolveWranglerConfig(tmpDist, undefined, "/fake/workspace");
    expect(result).not.toBeNull();
    expect(result!.wranglerConfigPath).toBe(astroWrangler);
    expect(result!.bootSmokeDistDir).toBe(join(tmpDist, "server"));
  });

  it("falls back to dist/../wrangler.jsonc when no Astro output", () => {
    const tmpParent = mkdtempSync(join(tmpdir(), "boot-smoke-fallback-"));
    const tmpDist = join(tmpParent, "dist");
    mkdirSync(tmpDist, { recursive: true });
    const fallbackWrangler = join(tmpParent, "wrangler.jsonc");
    writeFileSync(fallbackWrangler, "{}");
    const result = resolveWranglerConfig(tmpDist, undefined, "/fake/workspace");
    expect(result).not.toBeNull();
    expect(result!.wranglerConfigPath).toBe(fallbackWrangler);
    expect(result!.bootSmokeDistDir).toBe(tmpDist);
  });

  it("falls back to workpiece wrangler.jsonc when no Astro and no dist/../wrangler.jsonc", () => {
    const tmpWorkspace = mkdtempSync(join(tmpdir(), "boot-smoke-workspace-"));
    const tmpDist = mkdtempSync(join(tmpdir(), "boot-smoke-wpdist-"));
    const workpieceDir = join(tmpWorkspace, "missions", "workpiece");
    mkdirSync(workpieceDir, { recursive: true });
    const workpieceWrangler = join(workpieceDir, "wrangler.jsonc");
    writeFileSync(workpieceWrangler, "{}");
    const result = resolveWranglerConfig(tmpDist, undefined, tmpWorkspace);
    expect(result).not.toBeNull();
    expect(result!.wranglerConfigPath).toBe(workpieceWrangler);
    expect(result!.bootSmokeDistDir).toBe(tmpDist);
  });

  it("returns null when no wrangler config found anywhere", () => {
    const tmpDist = mkdtempSync(join(tmpdir(), "boot-smoke-nowrangler-"));
    const tmpWorkspace = mkdtempSync(join(tmpdir(), "boot-smoke-nows-"));
    const result = resolveWranglerConfig(tmpDist, undefined, tmpWorkspace);
    expect(result).toBeNull();
  });
});

describe("resolveLanguages", () => {
  it("parses comma-separated --languages flag", async () => {
    const tmpDist = mkdtempSync(join(tmpdir(), "boot-smoke-langflag-"));
    const languages = await resolveLanguages(tmpDist, "de,uk");
    expect(languages).toEqual(["de", "uk"]);
  });

  it("parses multi-value --languages flag with spaces", async () => {
    const tmpDist = mkdtempSync(join(tmpdir(), "boot-smoke-langspaces-"));
    const languages = await resolveLanguages(tmpDist, "de, en, uk");
    expect(languages).toEqual(["de", "en", "uk"]);
  });

  it("filters empty values from --languages flag", async () => {
    const tmpDist = mkdtempSync(join(tmpdir(), "boot-smoke-langempty-"));
    const languages = await resolveLanguages(tmpDist, "de,,uk,");
    expect(languages).toEqual(["de", "uk"]);
  });

  it("falls back to detectBootSmokeLanguages when --languages not provided", async () => {
    const tmpDist = mkdtempSync(join(tmpdir(), "boot-smoke-langauto-"));
    const clientDir = join(tmpDist, "client");
    mkdirSync(join(clientDir, "de"), { recursive: true });
    mkdirSync(join(clientDir, "uk"), { recursive: true });
    const languages = await resolveLanguages(tmpDist, undefined);
    expect(languages).toContain("de");
    expect(languages).toContain("uk");
    expect(languages).toHaveLength(2);
  });

  it("returns fallback [de, uk] when --languages not provided and dist/client/ empty", async () => {
    const tmpDist = mkdtempSync(join(tmpdir(), "boot-smoke-langfallback-"));
    const languages = await resolveLanguages(tmpDist, undefined);
    expect(languages).toEqual(["de", "uk"]);
  });
});
