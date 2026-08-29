// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { capturedMfOptions, MockMiniflare } = vi.hoisted(() => {
  const capturedMfOptions: Record<string, unknown>[] = [];
  class MockMiniflare {
    constructor(options: Record<string, unknown>) {
      capturedMfOptions.push(options);
    }
    async dispatchFetch(url: string): Promise<Response> {
      return new Response("ok", { status: 200 });
    }
    async dispose(): Promise<void> {}
  }
  return { capturedMfOptions, MockMiniflare };
});

vi.mock("miniflare", () => ({
  Miniflare: MockMiniflare,
}));

import { runBootSmoke } from "../release/boot-smoke.ts";

function createTempDist(): string {
  return mkdtempSync(join(tmpdir(), "boot-smoke-config-"));
}

function writeWranglerConfig(distDir: string, config: Record<string, unknown>): string {
  const wranglerPath = join(distDir, "wrangler.jsonc");
  writeFileSync(wranglerPath, JSON.stringify(config, null, 2));
  return wranglerPath;
}

describe("RFC-0977: Boot-smoke Miniflare configuration invariants", () => {
  let tmpDist: string;

  beforeEach(() => {
    tmpDist = createTempDist();
    capturedMfOptions.length = 0;
  });

  afterEach(() => {
    rmSync(tmpDist, { recursive: true, force: true });
  });

  // ─── INVARIANT-1: modulesRoot equals entry point directory ───────────

  describe("INVARIANT-1: modulesRoot", () => {
    it("sets modulesRoot to the entry point directory", async () => {
      const serverDir = join(tmpDist, "server");
      mkdirSync(serverDir, { recursive: true });
      const entryPath = join(serverDir, "entry.mjs");
      writeFileSync(entryPath, "export default {}");

      const wranglerPath = writeWranglerConfig(tmpDist, {
        name: "test-worker",
        main: "./dist/server/entry.mjs",
        compatibility_date: "2024-01-01",
      });

      await runBootSmoke({
        distDir: tmpDist,
        wranglerConfigPath: wranglerPath,
        requests: [{ path: "/", expectStatus: [200], kind: "page" }],
      });

      expect(capturedMfOptions.length).toBeGreaterThan(0);
      const opts = capturedMfOptions[0];
      expect(opts.modulesRoot, "modulesRoot must equal entry point directory").toBe(serverDir);
    });

    it("sets modulesRoot correctly for nested entry point", async () => {
      const serverDir = join(tmpDist, "server");
      mkdirSync(serverDir, { recursive: true });
      const entryPath = join(serverDir, "entry.mjs");
      writeFileSync(entryPath, "export default {}");

      const wranglerPath = writeWranglerConfig(tmpDist, {
        name: "test-worker",
        main: "./dist/server/entry.mjs",
        compatibility_date: "2024-01-01",
      });

      await runBootSmoke({
        distDir: tmpDist,
        wranglerConfigPath: wranglerPath,
        requests: [{ path: "/", expectStatus: [200], kind: "page" }],
      });

      const opts = capturedMfOptions[0];
      expect(opts.modulesRoot).toBe(serverDir);
      expect(opts.modulesRoot).not.toBe(tmpDist);
    });
  });

  // ─── INVARIANT-2: All .mjs files enumerated as ESModule entries ──────

  describe("INVARIANT-2: module enumeration", () => {
    it("enumerates entry.mjs and all chunk .mjs files in subdirectories", async () => {
      const serverDir = join(tmpDist, "server");
      const chunksDir = join(serverDir, "chunks");
      mkdirSync(chunksDir, { recursive: true });

      writeFileSync(join(serverDir, "entry.mjs"), "export default {}");
      writeFileSync(join(chunksDir, "default-handler.mjs"), "export {}");
      writeFileSync(join(chunksDir, "access-protection.mjs"), "export {}");
      writeFileSync(join(chunksDir, "render.mjs"), "export {}");

      const wranglerPath = writeWranglerConfig(tmpDist, {
        name: "test-worker",
        main: "./dist/server/entry.mjs",
        compatibility_date: "2024-01-01",
      });

      await runBootSmoke({
        distDir: tmpDist,
        wranglerConfigPath: wranglerPath,
        requests: [{ path: "/", expectStatus: [200], kind: "page" }],
      });

      const opts = capturedMfOptions[0];
      const modules = opts.modules as Array<{ type: string; path: string }>;
      expect(modules.length, "must enumerate entry + 3 chunk files = 4 modules").toBe(4);

      const paths = modules.map((m) => m.path);
      expect(paths).toContain(join(serverDir, "entry.mjs"));
      expect(paths).toContain(join(chunksDir, "default-handler.mjs"));
      expect(paths).toContain(join(chunksDir, "access-protection.mjs"));
      expect(paths).toContain(join(chunksDir, "render.mjs"));

      for (const mod of modules) {
        expect(mod.type, "all enumerated modules must be ESModule type").toBe("ESModule");
      }
    });

    it("enumerates .mjs files in nested subdirectories (chunks/sub/)", async () => {
      const serverDir = join(tmpDist, "server");
      const subDir = join(serverDir, "chunks", "sub");
      mkdirSync(subDir, { recursive: true });

      writeFileSync(join(serverDir, "entry.mjs"), "export default {}");
      writeFileSync(join(subDir, "nested.mjs"), "export {}");

      const wranglerPath = writeWranglerConfig(tmpDist, {
        name: "test-worker",
        main: "./dist/server/entry.mjs",
        compatibility_date: "2024-01-01",
      });

      await runBootSmoke({
        distDir: tmpDist,
        wranglerConfigPath: wranglerPath,
        requests: [{ path: "/", expectStatus: [200], kind: "page" }],
      });

      const opts = capturedMfOptions[0];
      const modules = opts.modules as Array<{ type: string; path: string }>;
      const paths = modules.map((m) => m.path);
      expect(paths).toContain(join(subDir, "nested.mjs"));
      expect(modules.length).toBe(2);
    });

    it("does not enumerate non-.mjs files", async () => {
      const serverDir = join(tmpDist, "server");
      mkdirSync(serverDir, { recursive: true });

      writeFileSync(join(serverDir, "entry.mjs"), "export default {}");
      writeFileSync(join(serverDir, "entry.js"), "export default {}");
      writeFileSync(join(serverDir, "worker.js"), "export default {}");
      writeFileSync(join(serverDir, "style.css"), "body { }");

      const wranglerPath = writeWranglerConfig(tmpDist, {
        name: "test-worker",
        main: "./dist/server/entry.mjs",
        compatibility_date: "2024-01-01",
      });

      await runBootSmoke({
        distDir: tmpDist,
        wranglerConfigPath: wranglerPath,
        requests: [{ path: "/", expectStatus: [200], kind: "page" }],
      });

      const opts = capturedMfOptions[0];
      const modules = opts.modules as Array<{ type: string; path: string }>;
      expect(modules.length, "only entry.mjs should be enumerated").toBe(1);
      expect(modules[0].path).toBe(join(serverDir, "entry.mjs"));
    });

    it("entry point is always first in the modules array", async () => {
      const serverDir = join(tmpDist, "server");
      const chunksDir = join(serverDir, "chunks");
      mkdirSync(chunksDir, { recursive: true });

      writeFileSync(join(serverDir, "entry.mjs"), "export default {}");
      writeFileSync(join(chunksDir, "aaa.mjs"), "export {}");
      writeFileSync(join(chunksDir, "zzz.mjs"), "export {}");

      const wranglerPath = writeWranglerConfig(tmpDist, {
        name: "test-worker",
        main: "./dist/server/entry.mjs",
        compatibility_date: "2024-01-01",
      });

      await runBootSmoke({
        distDir: tmpDist,
        wranglerConfigPath: wranglerPath,
        requests: [{ path: "/", expectStatus: [200], kind: "page" }],
      });

      const opts = capturedMfOptions[0];
      const modules = opts.modules as Array<{ type: string; path: string }>;
      expect(modules[0].path, "entry point must be first in modules array").toBe(
        join(serverDir, "entry.mjs"),
      );
    });

    it("handles empty entry directory (no chunks)", async () => {
      const serverDir = join(tmpDist, "server");
      mkdirSync(serverDir, { recursive: true });
      writeFileSync(join(serverDir, "entry.mjs"), "export default {}");

      const wranglerPath = writeWranglerConfig(tmpDist, {
        name: "test-worker",
        main: "./dist/server/entry.mjs",
        compatibility_date: "2024-01-01",
      });

      await runBootSmoke({
        distDir: tmpDist,
        wranglerConfigPath: wranglerPath,
        requests: [{ path: "/", expectStatus: [200], kind: "page" }],
      });

      const opts = capturedMfOptions[0];
      const modules = opts.modules as Array<{ type: string; path: string }>;
      expect(modules.length).toBe(1);
      expect(modules[0].path).toBe(join(serverDir, "entry.mjs"));
    });
  });

  // ─── INVARIANT-3: compatibilityFlags from wrangler config ───────────

  describe("INVARIANT-3: compatibilityFlags", () => {
    it("passes compatibility_flags from wrangler config to Miniflare", async () => {
      const serverDir = join(tmpDist, "server");
      mkdirSync(serverDir, { recursive: true });
      writeFileSync(join(serverDir, "entry.mjs"), "export default {}");

      const flags = ["nodejs_compat", "nodejs_compat_populate_process_env"];
      const wranglerPath = writeWranglerConfig(tmpDist, {
        name: "test-worker",
        main: "./dist/server/entry.mjs",
        compatibility_date: "2024-09-23",
        compatibility_flags: flags,
      });

      await runBootSmoke({
        distDir: tmpDist,
        wranglerConfigPath: wranglerPath,
        requests: [{ path: "/", expectStatus: [200], kind: "page" }],
      });

      const opts = capturedMfOptions[0];
      expect(
        opts.compatibilityFlags,
        "compatibilityFlags must match wrangler config compatibility_flags",
      ).toEqual(flags);
    });

    it("defaults compatibilityFlags to empty array when wrangler config has no compatibility_flags", async () => {
      const serverDir = join(tmpDist, "server");
      mkdirSync(serverDir, { recursive: true });
      writeFileSync(join(serverDir, "entry.mjs"), "export default {}");

      const wranglerPath = writeWranglerConfig(tmpDist, {
        name: "test-worker",
        main: "./dist/server/entry.mjs",
        compatibility_date: "2024-01-01",
      });

      await runBootSmoke({
        distDir: tmpDist,
        wranglerConfigPath: wranglerPath,
        requests: [{ path: "/", expectStatus: [200], kind: "page" }],
      });

      const opts = capturedMfOptions[0];
      expect(
        opts.compatibilityFlags,
        "compatibilityFlags must default to [] when not in wrangler config",
      ).toEqual([]);
    });

    it("passes single compatibility_flag correctly", async () => {
      const serverDir = join(tmpDist, "server");
      mkdirSync(serverDir, { recursive: true });
      writeFileSync(join(serverDir, "entry.mjs"), "export default {}");

      const wranglerPath = writeWranglerConfig(tmpDist, {
        name: "test-worker",
        main: "./dist/server/entry.mjs",
        compatibility_date: "2024-01-01",
        compatibility_flags: ["nodejs_compat"],
      });

      await runBootSmoke({
        distDir: tmpDist,
        wranglerConfigPath: wranglerPath,
        requests: [{ path: "/", expectStatus: [200], kind: "page" }],
      });

      const opts = capturedMfOptions[0];
      expect(opts.compatibilityFlags).toEqual(["nodejs_compat"]);
    });
  });

  // ─── Combined: all three invariants work together ───────────────────

  describe("Combined invariants (Astro Cloudflare adapter output simulation)", () => {
    it("configures all three invariants for a realistic Astro adapter output", async () => {
      const serverDir = join(tmpDist, "server");
      const chunksDir = join(serverDir, "chunks");
      mkdirSync(chunksDir, { recursive: true });

      writeFileSync(join(serverDir, "entry.mjs"), "export default {}");
      writeFileSync(join(chunksDir, "default-handler.mjs"), "export {}");
      writeFileSync(join(chunksDir, "access-protection.mjs"), "export {}");

      const wranglerPath = writeWranglerConfig(tmpDist, {
        name: "astro-worker",
        main: "./dist/server/entry.mjs",
        compatibility_date: "2024-09-23",
        compatibility_flags: ["nodejs_compat", "nodejs_compat_populate_process_env"],
        assets: {
          directory: "./dist/client",
          binding: "ASSETS",
        },
      });

      // Create client dir so assets resolution works
      mkdirSync(join(tmpDist, "client"), { recursive: true });

      await runBootSmoke({
        distDir: tmpDist,
        wranglerConfigPath: wranglerPath,
        requests: [
          { path: "/", expectStatus: [200], kind: "page" },
          { path: "/de/", expectStatus: [200], kind: "page" },
        ],
      });

      expect(capturedMfOptions.length).toBeGreaterThan(0);
      const opts = capturedMfOptions[0];

      // INVARIANT-1: modulesRoot
      expect(opts.modulesRoot).toBe(serverDir);

      // INVARIANT-2: all .mjs files enumerated
      const modules = opts.modules as Array<{ type: string; path: string }>;
      expect(modules.length).toBe(3);
      const paths = modules.map((m) => m.path);
      expect(paths).toContain(join(serverDir, "entry.mjs"));
      expect(paths).toContain(join(chunksDir, "default-handler.mjs"));
      expect(paths).toContain(join(chunksDir, "access-protection.mjs"));

      // INVARIANT-3: compatibilityFlags
      expect(opts.compatibilityFlags).toEqual([
        "nodejs_compat",
        "nodejs_compat_populate_process_env",
      ]);
    });
  });
});
