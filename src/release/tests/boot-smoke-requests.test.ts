// @vitest-environment node
import { describe, it, expect } from "vitest";
import { planBootSmokeRequests } from "../boot-smoke.ts";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("planBootSmokeRequests", () => {
  it("always includes root route", () => {
    const tmpDist = mkdtempSync(join(tmpdir(), "boot-smoke-req-root-"));
    const requests = planBootSmokeRequests({ distDir: tmpDist, languages: [] });
    const root = requests.find((r) => r.path === "/");
    expect(root).toBeDefined();
    expect(root!.kind).toBe("page");
    expect(root!.expectStatus).toEqual([200]);
  });

  it("includes one route per language", () => {
    const tmpDist = mkdtempSync(join(tmpdir(), "boot-smoke-req-perlang-"));
    const requests = planBootSmokeRequests({ distDir: tmpDist, languages: ["de", "uk"] });
    const deRoute = requests.find((r) => r.path === "/de/");
    const ukRoute = requests.find((r) => r.path === "/uk/");
    expect(deRoute).toBeDefined();
    expect(deRoute!.kind).toBe("page");
    expect(deRoute!.expectStatus).toEqual([200, 307, 308]);
    expect(ukRoute).toBeDefined();
    expect(ukRoute!.kind).toBe("page");
  });

  it("includes no language routes when languages is empty", () => {
    const tmpDist = mkdtempSync(join(tmpdir(), "boot-smoke-req-nolang-"));
    const requests = planBootSmokeRequests({ distDir: tmpDist, languages: [] });
    expect(requests.filter((r) => r.kind === "page" && r.path !== "/")).toHaveLength(0);
  });

  it("includes API route when dist/client/api/ exists", () => {
    const tmpDist = mkdtempSync(join(tmpdir(), "boot-smoke-req-api-"));
    mkdirSync(join(tmpDist, "client", "api"), { recursive: true });
    const requests = planBootSmokeRequests({ distDir: tmpDist, languages: ["de"] });
    const apiRoute = requests.find((r) => r.kind === "api");
    expect(apiRoute).toBeDefined();
    expect(apiRoute!.path).toBe("/api/");
    expect(apiRoute!.expectStatus).toEqual([200, 404]);
  });

  it("omits API route when dist/client/api/ does not exist", () => {
    const tmpDist = mkdtempSync(join(tmpdir(), "boot-smoke-req-noapi-"));
    const requests = planBootSmokeRequests({ distDir: tmpDist, languages: ["de"] });
    expect(requests.find((r) => r.kind === "api")).toBeUndefined();
  });

  it("includes favicon asset route when dist/client/ exists", () => {
    const tmpDist = mkdtempSync(join(tmpdir(), "boot-smoke-req-fav-"));
    mkdirSync(join(tmpDist, "client"), { recursive: true });
    const requests = planBootSmokeRequests({ distDir: tmpDist, languages: [] });
    const assetRoute = requests.find((r) => r.kind === "asset");
    expect(assetRoute).toBeDefined();
    expect(assetRoute!.path).toBe("/favicon.ico");
    expect(assetRoute!.expectStatus).toEqual([200, 404]);
  });

  it("omits favicon route when dist/client/ does not exist", () => {
    const tmpDist = mkdtempSync(join(tmpdir(), "boot-smoke-req-noclient-"));
    const requests = planBootSmokeRequests({ distDir: tmpDist, languages: [] });
    expect(requests.find((r) => r.kind === "asset")).toBeUndefined();
  });

  it("always includes 404 probe", () => {
    const tmpDist = mkdtempSync(join(tmpdir(), "boot-smoke-req-404-"));
    const requests = planBootSmokeRequests({ distDir: tmpDist, languages: [] });
    const notFound = requests.find((r) => r.kind === "not-found");
    expect(notFound).toBeDefined();
    expect(notFound!.path).toBe("/__boot-smoke-404-probe__");
    expect(notFound!.expectStatus).toEqual([404]);
  });

  it("includes page route from surface.generated.json when it exists", () => {
    const tmpDist = mkdtempSync(join(tmpdir(), "boot-smoke-req-surf-"));
    const surface = [{ path: "/about", kind: "page" }];
    writeFileSync(join(tmpDist, "surface.generated.json"), JSON.stringify(surface));
    const requests = planBootSmokeRequests({ distDir: tmpDist, languages: [] });
    const aboutRoute = requests.find((r) => r.path === "/about");
    expect(aboutRoute).toBeDefined();
    expect(aboutRoute!.kind).toBe("page");
    expect(aboutRoute!.expectStatus).toEqual([200]);
  });

  it("does not duplicate root route from surface.generated.json", () => {
    const tmpDist = mkdtempSync(join(tmpdir(), "boot-smoke-req-surfroot-"));
    const surface = [{ path: "/", kind: "page" }];
    writeFileSync(join(tmpDist, "surface.generated.json"), JSON.stringify(surface));
    const requests = planBootSmokeRequests({ distDir: tmpDist, languages: [] });
    const rootRoutes = requests.filter((r) => r.path === "/");
    expect(rootRoutes).toHaveLength(1);
  });

  it("does not duplicate routes already present from language planning", () => {
    const tmpDist = mkdtempSync(join(tmpdir(), "boot-smoke-req-nodup-"));
    const surface = [{ path: "/de/", kind: "page" }];
    writeFileSync(join(tmpDist, "surface.generated.json"), JSON.stringify(surface));
    const requests = planBootSmokeRequests({ distDir: tmpDist, languages: ["de"] });
    const deRoutes = requests.filter((r) => r.path === "/de/");
    expect(deRoutes).toHaveLength(1);
  });

  it("handles unparseable surface.generated.json gracefully", () => {
    const tmpDist = mkdtempSync(join(tmpdir(), "boot-smoke-req-badsurf-"));
    writeFileSync(join(tmpDist, "surface.generated.json"), "{invalid json");
    const requests = planBootSmokeRequests({ distDir: tmpDist, languages: ["de"] });
    expect(requests.find((r) => r.path === "/")).toBeDefined();
    expect(requests.find((r) => r.path === "/de/")).toBeDefined();
  });

  it("produces no duplicate paths across all request sources", () => {
    const tmpDist = mkdtempSync(join(tmpdir(), "boot-smoke-req-nodups-"));
    mkdirSync(join(tmpDist, "client", "api"), { recursive: true });
    const surface = [{ path: "/about", kind: "page" }];
    writeFileSync(join(tmpDist, "surface.generated.json"), JSON.stringify(surface));
    const requests = planBootSmokeRequests({ distDir: tmpDist, languages: ["de", "uk"] });
    const paths = requests.map((r) => r.path);
    const uniquePaths = new Set(paths);
    expect(paths.length).toBe(uniquePaths.size);
  });

  it("includes at least root, 404 probe, and language routes for a typical site", () => {
    const tmpDist = mkdtempSync(join(tmpdir(), "boot-smoke-req-typical-"));
    mkdirSync(join(tmpDist, "client"), { recursive: true });
    const requests = planBootSmokeRequests({ distDir: tmpDist, languages: ["de", "uk"] });
    const paths = requests.map((r) => r.path);
    expect(paths).toContain("/");
    expect(paths).toContain("/de/");
    expect(paths).toContain("/uk/");
    expect(paths).toContain("/favicon.ico");
    expect(paths).toContain("/__boot-smoke-404-probe__");
  });
});
