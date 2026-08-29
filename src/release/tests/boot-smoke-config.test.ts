// @vitest-environment node
import { describe, it, expect } from "vitest";
import { buildMiniflareOptions, simulateBindings } from "../boot-smoke.ts";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dummyFetch = (() => Promise.resolve(new Response("ok"))) as unknown as typeof fetch;

describe("buildMiniflareOptions", () => {
  it("returns null when worker entry point does not exist", async () => {
    const tmpDist = mkdtempSync(join(tmpdir(), "boot-smoke-cfg-noentry-"));
    const result = await buildMiniflareOptions({
      distDir: tmpDist,
      wranglerConfig: {},
      bindings: {},
      egressFetch: dummyFetch,
    });
    expect(result).toBeNull();
  });

  it("resolves Astro adapter entry.mjs when main is not present", async () => {
    const tmpDist = mkdtempSync(join(tmpdir(), "boot-smoke-cfg-astro-"));
    mkdirSync(join(tmpDist, "server"), { recursive: true });
    const entryPath = join(tmpDist, "server", "entry.mjs");
    writeFileSync(entryPath, "export default {}");
    const result = await buildMiniflareOptions({
      distDir: tmpDist,
      wranglerConfig: {},
      bindings: {},
      egressFetch: dummyFetch,
    });
    expect(result).not.toBeNull();
    const modules = result!.options["modules"] as Array<{ type: string; path: string }>;
    expect(modules[0].path).toBe(entryPath);
  });

  it("uses main from wrangler config when it exists", async () => {
    const tmpDist = mkdtempSync(join(tmpdir(), "boot-smoke-cfg-main-"));
    mkdirSync(join(tmpDist, "server"), { recursive: true });
    const entryPath = join(tmpDist, "server", "entry.mjs");
    writeFileSync(entryPath, "export default {}");
    const result = await buildMiniflareOptions({
      distDir: tmpDist,
      wranglerConfig: { main: "./dist/server/entry.mjs" },
      bindings: {},
      egressFetch: dummyFetch,
    });
    expect(result).not.toBeNull();
    const modules = result!.options["modules"] as Array<{ type: string; path: string }>;
    expect(modules[0].path).toBe(entryPath);
  });

  it("sets modulesRoot to the entry file's directory", async () => {
    const tmpDist = mkdtempSync(join(tmpdir(), "boot-smoke-cfg-root-"));
    mkdirSync(join(tmpDist, "server"), { recursive: true });
    writeFileSync(join(tmpDist, "server", "entry.mjs"), "export default {}");
    const result = await buildMiniflareOptions({
      distDir: tmpDist,
      wranglerConfig: {},
      bindings: {},
      egressFetch: dummyFetch,
    });
    expect(result).not.toBeNull();
    expect(result!.options["modulesRoot"]).toBe(join(tmpDist, "server"));
  });

  it("enumerates entry.mjs as the first ESModule entry", async () => {
    const tmpDist = mkdtempSync(join(tmpdir(), "boot-smoke-cfg-first-"));
    mkdirSync(join(tmpDist, "server"), { recursive: true });
    const entryPath = join(tmpDist, "server", "entry.mjs");
    writeFileSync(entryPath, "export default {}");
    const result = await buildMiniflareOptions({
      distDir: tmpDist,
      wranglerConfig: {},
      bindings: {},
      egressFetch: dummyFetch,
    });
    expect(result).not.toBeNull();
    const modules = result!.options["modules"] as Array<{ type: string; path: string }>;
    expect(modules[0].type).toBe("ESModule");
    expect(modules[0].path).toBe(entryPath);
  });

  it("enumerates chunk .mjs files as additional ESModule entries", async () => {
    const tmpDist = mkdtempSync(join(tmpdir(), "boot-smoke-cfg-chunks-"));
    const serverDir = join(tmpDist, "server");
    mkdirSync(join(serverDir, "chunks"), { recursive: true });
    writeFileSync(join(serverDir, "entry.mjs"), "export default {}");
    writeFileSync(join(serverDir, "chunks", "hello.mjs"), "export const hello = 1;");
    writeFileSync(join(serverDir, "chunks", "world.mjs"), "export const world = 2;");
    const result = await buildMiniflareOptions({
      distDir: tmpDist,
      wranglerConfig: {},
      bindings: {},
      egressFetch: dummyFetch,
    });
    expect(result).not.toBeNull();
    const modules = result!.options["modules"] as Array<{ type: string; path: string }>;
    expect(modules).toHaveLength(3);
    const chunkPaths = modules.slice(1).map((m) => m.path);
    expect(chunkPaths).toContain(join(serverDir, "chunks", "hello.mjs"));
    expect(chunkPaths).toContain(join(serverDir, "chunks", "world.mjs"));
  });

  it("excludes non-.mjs files from module enumeration", async () => {
    const tmpDist = mkdtempSync(join(tmpdir(), "boot-smoke-cfg-nonmjs-"));
    const serverDir = join(tmpDist, "server");
    mkdirSync(serverDir, { recursive: true });
    writeFileSync(join(serverDir, "entry.mjs"), "export default {}");
    writeFileSync(join(serverDir, "style.css"), "body { color: red; }");
    writeFileSync(join(serverDir, "data.json"), "{}");
    writeFileSync(join(serverDir, "readme.txt"), "hello");
    const result = await buildMiniflareOptions({
      distDir: tmpDist,
      wranglerConfig: {},
      bindings: {},
      egressFetch: dummyFetch,
    });
    expect(result).not.toBeNull();
    const modules = result!.options["modules"] as Array<{ type: string; path: string }>;
    expect(modules).toHaveLength(1);
  });

  it("passes compatibility_date from wrangler config", async () => {
    const tmpDist = mkdtempSync(join(tmpdir(), "boot-smoke-cfg-cdate-"));
    mkdirSync(join(tmpDist, "server"), { recursive: true });
    writeFileSync(join(tmpDist, "server", "entry.mjs"), "export default {}");
    const result = await buildMiniflareOptions({
      distDir: tmpDist,
      wranglerConfig: { compatibility_date: "2025-06-15" },
      bindings: {},
      egressFetch: dummyFetch,
    });
    expect(result).not.toBeNull();
    expect(result!.options["compatibilityDate"]).toBe("2025-06-15");
  });

  it("falls back to 2024-01-01 when compatibility_date is missing", async () => {
    const tmpDist = mkdtempSync(join(tmpdir(), "boot-smoke-cfg-cdatefb-"));
    mkdirSync(join(tmpDist, "server"), { recursive: true });
    writeFileSync(join(tmpDist, "server", "entry.mjs"), "export default {}");
    const result = await buildMiniflareOptions({
      distDir: tmpDist,
      wranglerConfig: {},
      bindings: {},
      egressFetch: dummyFetch,
    });
    expect(result).not.toBeNull();
    expect(result!.options["compatibilityDate"]).toBe("2024-01-01");
  });

  it("passes compatibility_flags from wrangler config", async () => {
    const tmpDist = mkdtempSync(join(tmpdir(), "boot-smoke-cfg-cflags-"));
    mkdirSync(join(tmpDist, "server"), { recursive: true });
    writeFileSync(join(tmpDist, "server", "entry.mjs"), "export default {}");
    const result = await buildMiniflareOptions({
      distDir: tmpDist,
      wranglerConfig: { compatibility_flags: ["nodejs_compat"] },
      bindings: {},
      egressFetch: dummyFetch,
    });
    expect(result).not.toBeNull();
    expect(result!.options["compatibilityFlags"]).toEqual(["nodejs_compat"]);
  });

  it("defaults compatibility_flags to empty array when missing", async () => {
    const tmpDist = mkdtempSync(join(tmpdir(), "boot-smoke-cfg-noflags-"));
    mkdirSync(join(tmpDist, "server"), { recursive: true });
    writeFileSync(join(tmpDist, "server", "entry.mjs"), "export default {}");
    const result = await buildMiniflareOptions({
      distDir: tmpDist,
      wranglerConfig: {},
      bindings: {},
      egressFetch: dummyFetch,
    });
    expect(result).not.toBeNull();
    expect(result!.options["compatibilityFlags"]).toEqual([]);
  });

  it("passes bindings from simulateBindings into options", async () => {
    const tmpDist = mkdtempSync(join(tmpdir(), "boot-smoke-cfg-bindings-"));
    mkdirSync(join(tmpDist, "server"), { recursive: true });
    writeFileSync(join(tmpDist, "server", "entry.mjs"), "export default {}");
    const { bindings } = simulateBindings({
      vars: { API_KEY: "test-key" },
      kv_namespaces: [{ binding: "MY_KV" }],
    });
    const result = await buildMiniflareOptions({
      distDir: tmpDist,
      wranglerConfig: {},
      bindings,
      egressFetch: dummyFetch,
    });
    expect(result).not.toBeNull();
    expect(result!.options["bindings"]).toBe(bindings);
  });

  it("includes assets config when assets.directory exists", async () => {
    const tmpDist = mkdtempSync(join(tmpdir(), "boot-smoke-cfg-assets-"));
    mkdirSync(join(tmpDist, "server"), { recursive: true });
    mkdirSync(join(tmpDist, "client"), { recursive: true });
    writeFileSync(join(tmpDist, "server", "entry.mjs"), "export default {}");
    const result = await buildMiniflareOptions({
      distDir: tmpDist,
      wranglerConfig: {
        assets: { directory: "./client", binding: "ASSETS" },
      },
      bindings: {},
      egressFetch: dummyFetch,
    });
    expect(result).not.toBeNull();
    const assets = result!.options["assets"] as Record<string, unknown>;
    expect(assets).toBeDefined();
    expect(assets["directory"]).toBe(join(tmpDist, "client"));
    expect(assets["binding"]).toBe("ASSETS");
  });

  it("uses default ASSETS binding name when not specified", async () => {
    const tmpDist = mkdtempSync(join(tmpdir(), "boot-smoke-cfg-asdef-"));
    mkdirSync(join(tmpDist, "server"), { recursive: true });
    mkdirSync(join(tmpDist, "client"), { recursive: true });
    writeFileSync(join(tmpDist, "server", "entry.mjs"), "export default {}");
    const result = await buildMiniflareOptions({
      distDir: tmpDist,
      wranglerConfig: {
        assets: { directory: "./client" },
      },
      bindings: {},
      egressFetch: dummyFetch,
    });
    expect(result).not.toBeNull();
    const assets = result!.options["assets"] as Record<string, unknown>;
    expect(assets["binding"]).toBe("ASSETS");
  });

  it("omits assets config when assets.directory does not exist", async () => {
    const tmpDist = mkdtempSync(join(tmpdir(), "boot-smoke-cfg-noassets-"));
    mkdirSync(join(tmpDist, "server"), { recursive: true });
    writeFileSync(join(tmpDist, "server", "entry.mjs"), "export default {}");
    const result = await buildMiniflareOptions({
      distDir: tmpDist,
      wranglerConfig: {
        assets: { directory: "../nonexistent" },
      },
      bindings: {},
      egressFetch: dummyFetch,
    });
    expect(result).not.toBeNull();
    expect(result!.options["assets"]).toBeUndefined();
  });

  it("passes run_worker_first as invoke_user_worker_ahead_of_assets", async () => {
    const tmpDist = mkdtempSync(join(tmpdir(), "boot-smoke-cfg-rwf-"));
    mkdirSync(join(tmpDist, "server"), { recursive: true });
    mkdirSync(join(tmpDist, "client"), { recursive: true });
    writeFileSync(join(tmpDist, "server", "entry.mjs"), "export default {}");
    const result = await buildMiniflareOptions({
      distDir: tmpDist,
      wranglerConfig: {
        assets: { directory: "./client", run_worker_first: true },
      },
      bindings: {},
      egressFetch: dummyFetch,
    });
    expect(result).not.toBeNull();
    const assets = result!.options["assets"] as Record<string, unknown>;
    expect(assets["invoke_user_worker_ahead_of_assets"]).toBe(true);
  });

  it("passes egress fetch function into options", async () => {
    const tmpDist = mkdtempSync(join(tmpdir(), "boot-smoke-cfg-egress-"));
    mkdirSync(join(tmpDist, "server"), { recursive: true });
    writeFileSync(join(tmpDist, "server", "entry.mjs"), "export default {}");
    const customFetch = (() => Promise.resolve(new Response("custom"))) as unknown as typeof fetch;
    const result = await buildMiniflareOptions({
      distDir: tmpDist,
      wranglerConfig: {},
      bindings: {},
      egressFetch: customFetch,
    });
    expect(result).not.toBeNull();
    expect(result!.options["fetch"]).toBe(customFetch);
  });
});
