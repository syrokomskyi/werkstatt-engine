import { describe, it, expect } from "vitest";
import { planBootSmokeRequests, simulateBindings } from "../release/boot-smoke.ts";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("planBootSmokeRequests", () => {
  it("includes root, language routes, 404 probe", () => {
    const tmpDist = mkdtempSync(join(tmpdir(), "boot-smoke-plan-"));
    const requests = planBootSmokeRequests({ distDir: tmpDist, languages: ["de", "en"] });

    const paths = requests.map((r) => r.path);
    expect(paths).toContain("/");
    expect(paths).toContain("/de/");
    expect(paths).toContain("/en/");
    expect(paths).toContain("/__boot-smoke-404-probe__");
  });

  it("includes asset probe when dist/client/ exists", () => {
    const tmpDist = mkdtempSync(join(tmpdir(), "boot-smoke-asset-"));
    mkdirSync(join(tmpDist, "client"), { recursive: true });
    const requests = planBootSmokeRequests({ distDir: tmpDist, languages: ["en"] });

    const paths = requests.map((r) => r.path);
    expect(paths).toContain("/favicon.ico");
  });

  it("includes API route when dist/client/api/ exists", () => {
    const tmpDist = mkdtempSync(join(tmpdir(), "boot-smoke-api-"));
    mkdirSync(join(tmpDist, "client", "api"), { recursive: true });
    const requests = planBootSmokeRequests({ distDir: tmpDist, languages: ["de"] });

    const apiRequests = requests.filter((r) => r.kind === "api");
    expect(apiRequests.length).toBeGreaterThan(0);
  });

  it("includes route from surface.generated.json when present", () => {
    const tmpDist = mkdtempSync(join(tmpdir(), "boot-smoke-surface-"));
    writeFileSync(
      join(tmpDist, "surface.generated.json"),
      JSON.stringify([{ path: "/about", kind: "page" }]),
    );
    const requests = planBootSmokeRequests({ distDir: tmpDist, languages: ["en"] });

    const paths = requests.map((r) => r.path);
    expect(paths).toContain("/about");
  });

  it("marks 404 probe as not-found kind", () => {
    const tmpDist = mkdtempSync(join(tmpdir(), "boot-smoke-404-"));
    const requests = planBootSmokeRequests({ distDir: tmpDist, languages: ["en"] });

    const notFound = requests.find((r) => r.kind === "not-found");
    expect(notFound).toBeDefined();
    expect(notFound!.expectStatus).toEqual([404]);
  });
});

describe("simulateBindings", () => {
  it("simulates KV namespaces as in-memory Maps", () => {
    const result = simulateBindings({
      kv_namespaces: [{ binding: "MY_KV" }],
    });
    expect(result.bindings["MY_KV"]).toBeInstanceOf(Map);
    expect(result.missingBindings).toEqual([]);
  });

  it("simulates R2 buckets as in-memory Maps", () => {
    const result = simulateBindings({
      r2_buckets: [{ binding: "MY_BUCKET" }],
    });
    expect(result.bindings["MY_BUCKET"]).toBeInstanceOf(Map);
    expect(result.missingBindings).toEqual([]);
  });

  it("simulates D1 databases with type marker", () => {
    const result = simulateBindings({
      d1_databases: [{ binding: "MY_DB" }],
    });
    expect(result.bindings["MY_DB"]).toEqual({ __type: "d1" });
    expect(result.missingBindings).toEqual([]);
  });

  it("simulates Vectorize indexes with stub query/upsert", () => {
    const result = simulateBindings({
      vectorize: [{ binding: "MY_INDEX" }],
    });
    const idx = result.bindings["MY_INDEX"] as {
      query: () => Promise<unknown>;
      upsert: () => Promise<void>;
    };
    expect(typeof idx.query).toBe("function");
    expect(typeof idx.upsert).toBe("function");
    expect(result.missingBindings).toEqual([]);
  });

  it("simulates vars and secrets as placeholder strings", () => {
    const result = simulateBindings({
      vars: { PUBLIC_KEY: "public-value" },
      secrets: { SECRET_KEY: "secret-value" },
    });
    expect(result.bindings["PUBLIC_KEY"]).toBe("public-value");
    expect(result.bindings["SECRET_KEY"]).toBe("secret-value");
  });

  it("simulates ASSETS binding with type marker", () => {
    const result = simulateBindings({
      assets: { directory: "./dist/client" },
    });
    expect(result.bindings["ASSETS"]).toEqual({ __type: "assets" });
  });

  it("reports unknown binding types in missingBindings (fail-closed)", () => {
    const result = simulateBindings({
      durable_objects: [{ binding: "MY_DO", class_name: "Counter" }],
    });
    expect(result.missingBindings).toContain("durable_objects");
  });

  it("does not report non-binding config keys as missing", () => {
    const result = simulateBindings({
      name: "my-worker",
      main: "./dist/_worker.js/index.js",
      compatibility_date: "2024-01-01",
      compatibility_flags: ["nodejs_compat"],
    });
    expect(result.missingBindings).toEqual([]);
  });
});
