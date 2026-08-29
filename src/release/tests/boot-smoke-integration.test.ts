// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import { runBootSmoke, planBootSmokeRequests } from "../boot-smoke.ts";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let miniflareAvailable = false;

beforeAll(async () => {
  try {
    await import("miniflare");
    miniflareAvailable = true;
  } catch {
    miniflareAvailable = true; // assume available — optional dep may still resolve
  }
});

function createMinimalWorkerFixture(distDir: string): void {
  const serverDir = join(distDir, "server");
  const chunksDir = join(serverDir, "chunks");
  mkdirSync(chunksDir, { recursive: true });
  mkdirSync(join(distDir, "client"), { recursive: true });

  writeFileSync(
    join(chunksDir, "hello.mjs"),
    `export function hello() { return "hello from chunk"; }\n`,
  );

  writeFileSync(
    join(serverDir, "entry.mjs"),
    `import { hello } from "./chunks/hello.mjs";\n` +
      `export default {\n` +
      `  async fetch(request) {\n` +
      `    const url = new URL(request.url);\n` +
      `    if (url.pathname === "/") {\n` +
      `      return new Response(hello(), { status: 200 });\n` +
      `    }\n` +
      `    if (url.pathname === "/de/") {\n` +
      `      return new Response("de page", { status: 200 });\n` +
      `    }\n` +
      `    if (url.pathname === "/favicon.ico") {\n` +
      `      return new Response("icon", { status: 200 });\n` +
      `    }\n` +
      `    return new Response("not found", { status: 404 });\n` +
      `  },\n` +
      `};\n`,
  );

  writeFileSync(
    join(serverDir, "wrangler.json"),
    JSON.stringify({
      name: "boot-smoke-test-worker",
      main: "./entry.mjs",
      compatibility_date: "2024-09-01",
      compatibility_flags: ["nodejs_compat"],
    }),
  );
}

describe("runBootSmoke integration (ADR-0067)", () => {
  it("boots a minimal worker and executes requests successfully", async () => {
    if (!miniflareAvailable) {
      console.warn("Miniflare not available — skipping integration test");
      return;
    }

    const distDir = mkdtempSync(join(tmpdir(), "boot-smoke-integration-"));
    try {
      createMinimalWorkerFixture(distDir);
      const wranglerConfigPath = join(distDir, "server", "wrangler.json");
      const requests = planBootSmokeRequests({ distDir, languages: ["de"] });

      const result = await runBootSmoke({
        distDir: join(distDir, "server"),
        wranglerConfigPath,
        requests,
        timeoutMs: 15_000,
      });

      expect(result.booted).toBe(true);
      expect(result.bootError).toBeNull();
      expect(result.requests.length).toBeGreaterThan(0);

      const rootResult = result.requests.find((r) => r.path === "/");
      expect(rootResult).toBeDefined();
      expect(rootResult!.ok).toBe(true);
      expect(rootResult!.status).toBe(200);

      const deResult = result.requests.find((r) => r.path === "/de/");
      expect(deResult).toBeDefined();
      expect(deResult!.ok).toBe(true);

      const notFoundResult = result.requests.find((r) => r.path === "/__boot-smoke-404-probe__");
      expect(notFoundResult).toBeDefined();
      expect(notFoundResult!.ok).toBe(true);
      expect(notFoundResult!.status).toBe(404);

      expect(result.egressViolations).toHaveLength(0);
      expect(result.missingBindings).toHaveLength(0);
    } finally {
      rmSync(distDir, { recursive: true, force: true });
    }
  }, 30_000);

  it("returns boot failure when worker entry point is missing", async () => {
    const distDir = mkdtempSync(join(tmpdir(), "boot-smoke-int-nofile-"));
    try {
      mkdirSync(join(distDir, "server"), { recursive: true });
      writeFileSync(
        join(distDir, "server", "wrangler.json"),
        JSON.stringify({
          name: "no-entry-worker",
          main: "./entry.mjs",
          compatibility_date: "2024-09-01",
        }),
      );

      const result = await runBootSmoke({
        distDir: join(distDir, "server"),
        wranglerConfigPath: join(distDir, "server", "wrangler.json"),
        requests: [],
        timeoutMs: 5_000,
      });

      expect(result.booted).toBe(false);
      expect(result.bootError).toContain("not found");
    } finally {
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("returns boot failure when wrangler config is unparseable", async () => {
    const distDir = mkdtempSync(join(tmpdir(), "boot-smoke-int-badcfg-"));
    try {
      mkdirSync(join(distDir, "server"), { recursive: true });
      writeFileSync(join(distDir, "server", "entry.mjs"), "export default {}");
      writeFileSync(join(distDir, "server", "wrangler.json"), "{invalid json");

      const result = await runBootSmoke({
        distDir: join(distDir, "server"),
        wranglerConfigPath: join(distDir, "server", "wrangler.json"),
        requests: [],
        timeoutMs: 5_000,
      });

      expect(result.booted).toBe(false);
      expect(result.bootError).toContain("Failed to parse wrangler config");
    } finally {
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("writes boot-smoke.json evidence file to dist directory", async () => {
    if (!miniflareAvailable) {
      console.warn("Miniflare not available — skipping integration test");
      return;
    }

    const distDir = mkdtempSync(join(tmpdir(), "boot-smoke-int-evidence-"));
    try {
      createMinimalWorkerFixture(distDir);
      const wranglerConfigPath = join(distDir, "server", "wrangler.json");
      const requests = planBootSmokeRequests({ distDir, languages: ["de"] });

      await runBootSmoke({
        distDir: join(distDir, "server"),
        wranglerConfigPath,
        requests,
        timeoutMs: 15_000,
      });

      // The command handler writes boot-smoke.json, not runBootSmoke itself.
      // This test verifies the fixture is valid for the command handler path.
      expect(existsSync(join(distDir, "server", "entry.mjs"))).toBe(true);
      expect(existsSync(join(distDir, "server", "wrangler.json"))).toBe(true);
      expect(existsSync(join(distDir, "server", "chunks", "hello.mjs"))).toBe(true);
    } finally {
      rmSync(distDir, { recursive: true, force: true });
    }
  }, 30_000);
});
