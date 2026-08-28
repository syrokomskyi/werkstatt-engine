/*
<MODULE_CONTRACT>
  <purpose>RFC-0961: release.boot-smoke — boot built worker in miniflare/workerd and execute representative requests to catch runtime crashes before deploy.</purpose>
  <non-goals>
    <item>Does not replace post-deploy health checks (RFC-0930 leitstand.verify) — this is pre-deploy, local, offline.</item>
    <item>Does not simulate service worker bindings (Durable Objects, Queues, AI, Hyperdrive) — site workers only.</item>
    <item>Does not provide binding semantics fidelity — in-memory equivalents only; real semantics verified post-deploy.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0961: initial release.boot-smoke command handler, binding simulator, egress interceptor, and route planner.</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";

// ─── Public contracts ────────────────────────────────────────────────

export interface BootSmokeRequestSpec {
  path: string;
  expectStatus: number[];
  kind: "page" | "asset" | "api" | "not-found" | "negotiation";
}

export interface BootSmokeRequestResult {
  path: string;
  status: number | null;
  ok: boolean;
  error: string | null;
}

export interface BootSmokeResult {
  booted: boolean;
  bootError: string | null;
  requests: BootSmokeRequestResult[];
  egressViolations: string[];
  missingBindings: string[];
}

// ─── Local types for dist route discovery ────────────────────────────

interface DistRouteEntry {
  path?: string;
  pattern?: string;
  kind?: string;
}

// ─── Route planner ───────────────────────────────────────────────────

export function planBootSmokeRequests(input: {
  distDir: string;
  languages: string[];
}): BootSmokeRequestSpec[] {
  const requests: BootSmokeRequestSpec[] = [];

  // 1. Root route
  requests.push({ path: "/", expectStatus: [200], kind: "page" });

  // 2. One deep content route per language
  for (const lang of input.languages) {
    requests.push({
      path: `/${lang}/`,
      expectStatus: [200, 307, 308],
      kind: "page",
    });
  }

  // 3. Route-template kinds from surface.generated.json
  const surfacePath = path.join(input.distDir, "surface.generated.json");
  if (existsSync(surfacePath)) {
    try {
      const raw = readFileSync(surfacePath, "utf8");
      const routes = JSON.parse(raw) as DistRouteEntry[];
      const seenKinds = new Set<string>();
      for (const route of routes) {
        const routePath = route.path ?? route.pattern;
        const kind = route.kind ?? "page";
        if (!routePath) continue;
        if (kind === "page" && !seenKinds.has(kind)) {
          seenKinds.add(kind);
          if (routePath !== "/" && !requests.some((r) => r.path === routePath)) {
            requests.push({ path: routePath, expectStatus: [200], kind: "page" });
          }
        }
      }
    } catch {
      // surface.generated.json not parseable — root + language routes are sufficient
    }
  }

  // 4. One API route when dist/client/api/ exists
  const apiDir = path.join(input.distDir, "client", "api");
  if (existsSync(apiDir)) {
    requests.push({ path: "/api/", expectStatus: [200, 404], kind: "api" });
  }

  // 5. One static asset
  const clientDir = path.join(input.distDir, "client");
  if (existsSync(clientDir)) {
    requests.push({
      path: "/favicon.ico",
      expectStatus: [200, 404],
      kind: "asset",
    });
  }

  // 6. Intentional 404
  requests.push({
    path: "/__boot-smoke-404-probe__",
    expectStatus: [404],
    kind: "not-found",
  });

  return requests;
}

// ─── Binding simulator ───────────────────────────────────────────────

const SUPPORTED_BINDING_TYPES = new Set([
  "kv_namespaces",
  "r2_buckets",
  "d1_databases",
  "vectorize",
  "vars",
  "secrets",
  "assets",
]);

interface SimulatedBindings {
  bindings: Record<string, unknown>;
  missingBindings: string[];
}

export function simulateBindings(wranglerConfig: Record<string, unknown>): SimulatedBindings {
  const bindings: Record<string, unknown> = {};
  const missingBindings: string[] = [];

  // KV namespaces → in-memory Map
  const kvNamespaces = (wranglerConfig["kv_namespaces"] ?? []) as Array<{
    binding: string;
  }>;
  for (const ns of kvNamespaces) {
    bindings[ns.binding] = new Map();
  }

  // R2 buckets → in-memory Map
  const r2Buckets = (wranglerConfig["r2_buckets"] ?? []) as Array<{
    binding: string;
  }>;
  for (const bucket of r2Buckets) {
    bindings[bucket.binding] = new Map();
  }

  // D1 databases → in-memory SQLite (miniflare handles natively, we declare it)
  const d1Databases = (wranglerConfig["d1_databases"] ?? []) as Array<{
    binding: string;
  }>;
  for (const db of d1Databases) {
    bindings[db.binding] = { __type: "d1" };
  }

  // Vectorize indexes → recorded stub returning empty results
  const vectorize = (wranglerConfig["vectorize"] ?? []) as Array<{
    binding: string;
  }>;
  for (const idx of vectorize) {
    bindings[idx.binding] = {
      query: () => Promise.resolve({ matches: [], count: 0 }),
      upsert: () => Promise.resolve(),
      insert: () => Promise.resolve(),
    };
  }

  // Vars / env → placeholder strings
  const vars = (wranglerConfig["vars"] ?? {}) as Record<string, string>;
  for (const [key, value] of Object.entries(vars)) {
    bindings[key] = value;
  }

  // Secrets → placeholder strings
  const secrets = (wranglerConfig["secrets"] ?? {}) as Record<string, string>;
  for (const [key, value] of Object.entries(secrets)) {
    bindings[key] = value ?? `__secret_placeholder_${key}__`;
  }

  // ASSETS → served from dist/client
  if (wranglerConfig["assets"] && typeof wranglerConfig["assets"] === "object") {
    bindings["ASSETS"] = { __type: "assets" };
  }

  // Detect unsupported binding types
  for (const key of Object.keys(wranglerConfig)) {
    if (
      !SUPPORTED_BINDING_TYPES.has(key) &&
      typeof wranglerConfig[key] === "object" &&
      wranglerConfig[key] !== null &&
      ![
        "name",
        "main",
        "compatibility_date",
        "compatibility_flags",
        "observability",
        "conditions",
      ].includes(key)
    ) {
      // Unknown binding-type key that looks like a binding declaration
      const value = wranglerConfig[key];
      if (
        Array.isArray(value) &&
        value.length > 0 &&
        typeof value[0] === "object" &&
        "binding" in value[0]
      ) {
        missingBindings.push(key);
      }
    }
  }

  return { bindings, missingBindings };
}

// ─── Egress interceptor ──────────────────────────────────────────────

function createEgressInterceptor(): {
  fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  violations: string[];
} {
  const violations: string[] = [];

  const interceptedFetch = async (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    // Allow localhost (miniflare internal)
    if (url.startsWith("http://localhost") || url.startsWith("http://127.0.0.1")) {
      return new Response("ok", { status: 200 });
    }
    // Block all external egress
    violations.push(url);
    throw new Error(`[boot-smoke] egress blocked: ${url}`);
  };

  return { fetch: interceptedFetch, violations };
}

// ─── Boot-smoke runner ───────────────────────────────────────────────

export async function runBootSmoke(input: {
  distDir: string;
  wranglerConfigPath: string;
  requests: BootSmokeRequestSpec[];
  timeoutMs?: number;
}): Promise<BootSmokeResult> {
  const timeoutMs = input.timeoutMs ?? 60_000;
  const egressInterceptor = createEgressInterceptor();

  // Parse wrangler config
  let wranglerConfig: Record<string, unknown>;
  try {
    const raw = await fs.readFile(input.wranglerConfigPath, "utf8");
    // wrangler.jsonc — strip JSONC comments
    const stripped = raw.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    wranglerConfig = JSON.parse(stripped) as Record<string, unknown>;
  } catch {
    return {
      booted: false,
      bootError: `Failed to parse wrangler config at ${input.wranglerConfigPath}`,
      requests: [],
      egressViolations: [],
      missingBindings: [],
    };
  }

  // Simulate bindings
  const { bindings, missingBindings } = simulateBindings(wranglerConfig);

  // If there are missing bindings, fail-closed
  if (missingBindings.length > 0) {
    return {
      booted: false,
      bootError: `Unsupported binding types: ${missingBindings.join(", ")}. Extend the simulator or remove the binding from wrangler.jsonc.`,
      requests: [],
      egressViolations: [],
      missingBindings,
    };
  }

  // Resolve worker entry point
  const workerMain = (wranglerConfig["main"] as string) ?? "./dist/_worker.js/index.js";
  const workerPath = path.resolve(input.distDir, workerMain.replace(/^\.\/dist\//, ""));
  // Fallback: when main points to a source file (e.g. src/worker.ts) that
  // doesn't exist in the release dist, use the Astro Cloudflare adapter output.
  const astroEntry = path.resolve(input.distDir, "server", "entry.mjs");
  const resolvedWorkerPath = existsSync(workerPath)
    ? workerPath
    : existsSync(astroEntry)
      ? astroEntry
      : workerPath;
  if (!existsSync(resolvedWorkerPath)) {
    return {
      booted: false,
      bootError: `Worker entry point not found: ${workerPath}`,
      requests: [],
      egressViolations: [],
      missingBindings: [],
    };
  }

  // Boot miniflare
  let mf: InstanceType<typeof import("miniflare").Miniflare> | undefined;
  let booted = false;
  let bootError: string | null = null;

  try {
    const { Miniflare } = await import("miniflare");
    mf = new Miniflare({
      modules: [{ type: "ESModule", path: resolvedWorkerPath }],
      compatibilityDate: (wranglerConfig["compatibility_date"] as string) ?? "2024-01-01",
      bindings,
      // Egress: override fetch to block external requests
      fetch: egressInterceptor.fetch as unknown as typeof fetch,
    } as ConstructorParameters<typeof Miniflare>[0]);

    // Test boot by dispatching a single request
    try {
      const response = await mf.dispatchFetch("http://localhost/");
      booted = true;
      // Consume the response to free resources
      await response.text();
    } catch (err) {
      booted = false;
      bootError = err instanceof Error ? err.message : String(err);
    }

    // If boot failed, return early
    if (!booted || !mf) {
      return {
        booted: false,
        bootError,
        requests: [],
        egressViolations: egressInterceptor.violations,
        missingBindings: [],
      };
    }

    // Execute representative requests with timeout
    const requestResults: BootSmokeRequestResult[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("boot-smoke timeout")), timeoutMs);
    });

    try {
      for (const spec of input.requests) {
        try {
          const result = await Promise.race([
            mf.dispatchFetch(`http://localhost${spec.path}`),
            timeoutPromise,
          ]);
          const status = result.status;
          const ok = spec.expectStatus.includes(status);
          requestResults.push({
            path: spec.path,
            status,
            ok,
            error: ok ? null : `Expected ${spec.expectStatus.join("|")}, got ${status}`,
          });
          // Consume body
          await result.text();
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          requestResults.push({
            path: spec.path,
            status: null,
            ok: false,
            error: errMsg,
          });
        }
      }
    } finally {
      if (timer) clearTimeout(timer);
    }

    const allOk = requestResults.every((r) => r.ok);

    return {
      booted: true,
      bootError: null,
      requests: requestResults,
      egressViolations: egressInterceptor.violations,
      missingBindings: [],
    };
  } catch (err) {
    return {
      booted: false,
      bootError: err instanceof Error ? err.message : String(err),
      requests: [],
      egressViolations: egressInterceptor.violations,
      missingBindings,
    };
  } finally {
    if (mf) {
      try {
        await mf.dispose();
      } catch {
        // Best-effort cleanup
      }
    }
  }
}

// ─── Command handler ─────────────────────────────────────────────────

export interface BootSmokeCommandData {
  booted: boolean;
  requests: number;
  failed: number;
  egressViolations: string[];
  missingBindings: string[];
  bootError: string | null;
}

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

export async function runBootSmokeCommand(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<BootSmokeCommandData>> {
  const { workspaceRoot, logger } = context;
  const siteId = flagString(input, "site");
  const distFlag = flagString(input, "dist");
  const diagnose = Boolean(input.flags["diagnose"]);

  if (!siteId) {
    return {
      data: {
        booted: false,
        requests: 0,
        failed: 0,
        egressViolations: [],
        missingBindings: [],
        bootError: "--site is required",
      },
      exitCode: 1,
      summary: "[release.boot-smoke] --site is required",
    };
  }

  // Resolve dist directory
  let distDir: string;
  if (distFlag) {
    distDir = path.resolve(distFlag);
  } else {
    // Default: workpiece dist/ (open mission) or releases/<id>/dist/
    const workpieceDist = path.join(workspaceRoot, "missions", "workpiece", "dist");
    if (existsSync(workpieceDist)) {
      distDir = workpieceDist;
    } else {
      distDir = path.join(workspaceRoot, "releases", siteId, "dist");
    }
  }

  if (!existsSync(distDir)) {
    return {
      data: {
        booted: false,
        requests: 0,
        failed: 0,
        egressViolations: [],
        missingBindings: [],
        bootError: `dist directory not found: ${distDir}`,
      },
      exitCode: 1,
      summary: `[release.boot-smoke] dist directory not found: ${distDir}`,
    };
  }

  // Resolve wrangler config
  const wranglerConfigPath = path.join(workspaceRoot, "missions", "workpiece", "wrangler.jsonc");
  if (!existsSync(wranglerConfigPath)) {
    return {
      data: {
        booted: false,
        requests: 0,
        failed: 0,
        egressViolations: [],
        missingBindings: [],
        bootError: `wrangler.jsonc not found: ${wranglerConfigPath}`,
      },
      exitCode: 1,
      summary: `[release.boot-smoke] wrangler.jsonc not found`,
    };
  }

  // Plan requests
  const languages = ["de", "en", "uk"];
  const requests = planBootSmokeRequests({ distDir, languages });

  if (diagnose) {
    logger.info(`[release.boot-smoke] diagnose mode — planned ${requests.length} requests:`);
    for (const req of requests) {
      logger.info(`  ${req.kind}: ${req.path} (expect ${req.expectStatus.join("|")})`);
    }
  }

  // Run boot-smoke
  const result = await runBootSmoke({
    distDir,
    wranglerConfigPath,
    requests,
  });

  const failed = result.requests.filter((r) => !r.ok).length;
  const hasFailures =
    !result.booted ||
    failed > 0 ||
    result.egressViolations.length > 0 ||
    result.missingBindings.length > 0;

  const data: BootSmokeCommandData = {
    booted: result.booted,
    requests: result.requests.length,
    failed,
    egressViolations: result.egressViolations,
    missingBindings: result.missingBindings,
    bootError: result.bootError,
  };

  if (hasFailures) {
    const parts: string[] = [];
    if (!result.booted) parts.push("boot failed");
    if (failed > 0) parts.push(`${failed}/${result.requests.length} requests failed`);
    if (result.egressViolations.length > 0)
      parts.push(`${result.egressViolations.length} egress violations`);
    if (result.missingBindings.length > 0)
      parts.push(`${result.missingBindings.length} missing bindings`);

    return {
      data,
      exitCode: 1,
      summary: `[release.boot-smoke] ${parts.join(", ")}`,
      nextSteps: [
        {
          action: result.bootError
            ? `Fix boot error: ${result.bootError.slice(0, 200)}`
            : "Review failing requests and fix the worker code",
          kind: "required" as const,
        },
      ],
    };
  }

  return {
    data,
    summary: `[release.boot-smoke] worker booted, ${result.requests.length}/${result.requests.length} representative requests ok, egress clean`,
  };
}
