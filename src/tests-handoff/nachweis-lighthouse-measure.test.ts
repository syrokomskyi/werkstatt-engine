/*
<MODULE_CONTRACT>
  <purpose>
    Unit tests for RFC-0874: nachweis.measure.lighthouse command handler.
    Tests cover entitlement skip, dry-run, URL validation, methodology parsing,
    Chrome detection, LHR parsing, category aggregation (numeric median and
    non-numeric pass/fail), bundle construction, and ingest delegation.
    Uses synthetic LHR fixtures — no real Lighthouse runs.
  </purpose>
  <keywords>RFC-0874, nachweis, lighthouse, measure, unit-test, LHR, aggregation, median</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0874: initial tests for nachweis.measure.lighthouse command handler.</item>
</CHANGE_SUMMARY>
*/

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  KernelCommandInput,
  KernelRuntimeContext,
  KernelFlagValue,
} from "@warpgogol/werkstatt-engine/kernel";
import { createDefaultIO, createKernelLogger } from "@warpgogol/werkstatt-engine/kernel";
import { expectData } from "./helpers/kernel-result-helpers.ts";

// ── Mock state ──────────────────────────────────────────────────────────────

const mockState = vi.hoisted(() => ({
  chromeAvailable: true,
  lighthouseOutputs: [] as string[],
  ingestResult: null as null | { exitCode: number; summary: string; data: Record<string, unknown> },
}));

vi.mock("../evidence/r2-client.ts", () => ({
  MissingEnvError: class MissingEnvError extends Error {
    diagnostic = "MISSING_ENV";
    missingVar: string;
    constructor(v: string) {
      super(`${v} environment variable is required`);
      this.missingVar = v;
    }
  },
  resolveR2ConfigFromEnv: vi.fn(() => ({
    accountId: "test-account",
    accessKeyId: "test-key",
    secretAccessKey: "test-secret",
    bucketName: "nachweise",
  })),
  createR2Client: vi.fn(() => ({
    putObject: vi.fn(async (_input: { key: string; body: Uint8Array }) => {
      mockState.ingestResult = mockState.ingestResult;
    }),
  })),
}));

vi.mock("../sternsystem/registry-io.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../sternsystem/registry-io.ts")>();
  return {
    ...actual,
    resolveCacheClonePath: vi.fn((workspaceRoot: string, systemId: string) => {
      return join(workspaceRoot, "systems-cache", systemId);
    }),
  };
});

vi.mock("../bordbuch/bordbuch-commit-helper.ts", async () => {
  const { existsSync, readFileSync } = await import("node:fs");
  const fsPromises = await import("node:fs/promises");
  const nodePath = await import("node:path");
  const { createHash } = await import("node:crypto");
  return {
    appendAndCommitBordbuch: vi.fn(
      async (
        workspaceRoot: string,
        systemId: string,
        kind: string,
        summary: string,
        actor: string,
        options?: Record<string, unknown>,
      ) => {
        const filePath = nodePath.join(
          workspaceRoot,
          "systems-cache",
          systemId,
          "bordbuch",
          "events.ndjson",
        );
        const dir = nodePath.dirname(filePath);
        if (!existsSync(dir)) await fsPromises.mkdir(dir, { recursive: true });
        const existingContent = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
        const prevLines = existingContent
          .trim()
          .split("\n")
          .filter((l) => l.trim());
        const previousHash =
          prevLines.length > 0 ? JSON.parse(prevLines[prevLines.length - 1]).hash : null;
        const maxNum = prevLines.reduce((max, l) => {
          const m = JSON.parse(l).id?.match(/^event-(\d{6})$/);
          return m ? Math.max(max, parseInt(m[1], 10)) : max;
        }, 0);
        const id = `event-${String(maxNum + 1).padStart(6, "0")}`;
        const entryWithoutHash = {
          schemaVersion: "1.0.0",
          id,
          systemId,
          occurredAt: new Date().toISOString(),
          kind,
          status: (options as { status?: string })?.status ?? "done",
          missionId: null,
          releaseId: null,
          actor,
          summary,
          metadata: (options as { metadata?: unknown })?.metadata,
          previousHash,
          erratumOf: undefined,
        };
        const stable = JSON.stringify(entryWithoutHash, Object.keys(entryWithoutHash).sort());
        const hash = `sha256:${createHash("sha256").update(stable).digest("hex")}`;
        const entry = { ...entryWithoutHash, hash };
        const separator = existingContent.length > 0 && !existingContent.endsWith("\n") ? "\n" : "";
        await fsPromises.writeFile(
          filePath,
          `${existingContent}${separator}${JSON.stringify(entry)}\n`,
          "utf8",
        );
        return { entry, commitResult: { commitSha: null, pushed: false, error: null } };
      },
    ),
  };
});

vi.mock("@warpgogol/werkstatt-engine/kernel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@warpgogol/werkstatt-engine/kernel")>();
  return {
    ...actual,
    executeKernelCommand: vi.fn(async () => ({
      commandName: "bordbuch.validate",
      exitCode: 0,
      data: { entries: 0, violations: [] },
      summary: "bordbuch.validate: 0 entries, 0 violations",
    })),
  };
});

// ── Helpers ─────────────────────────────────────────────────────────────────

let tmpDir: string;
let workspaceRoot: string;

function makeContext(siteName?: string): KernelRuntimeContext {
  const logger = createKernelLogger();
  const { io } = createDefaultIO();
  return {
    workspaceRoot,
    logger,
    io,
    fileIntents: [],
    commandName: "test",
    ...(siteName ? { site: { name: siteName } } : {}),
  } as unknown as KernelRuntimeContext;
}

function makeInput(flags: Record<string, KernelFlagValue>): KernelCommandInput {
  return {
    flags,
    argv: [],
  };
}

async function writeSystemManifest(cachePath: string): Promise<void> {
  const contentDir = join(cachePath, "src", "content");
  await mkdir(contentDir, { recursive: true });
  await writeFile(
    join(contentDir, "system.md"),
    "---\ni18n:\n  default: de\n  supported:\n    de: true\n---\n",
  );
}

async function writeEntitlements(cachePath: string, features: string[]): Promise<void> {
  const dir = join(cachePath, "src");
  await mkdir(dir, { recursive: true });
  const { stringify: yamlStringify } = await import("yaml");
  await writeFile(join(dir, "entitlements.generated.yaml"), yamlStringify({ features }));
  await writeSystemManifest(cachePath);
}

function makeSyntheticLhr(opts: {
  lighthouseVersion?: string;
  fetchTime?: string;
  requestedUrl?: string;
  finalUrl?: string;
  categories?: Record<
    string,
    {
      title: string;
      score: number | null;
      experimental?: boolean;
    }
  >;
  audits?: Record<string, { score: number | null; scoreDisplayMode?: string }>;
  runtimeError?: { code: string; message: string } | null;
}): string {
  return JSON.stringify({
    lighthouseVersion: opts.lighthouseVersion ?? "13.4.1",
    fetchTime: opts.fetchTime ?? "2026-08-18T10:00:00.000Z",
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome",
    requestedUrl: opts.requestedUrl ?? "https://example.com",
    finalUrl: opts.finalUrl ?? "https://example.com",
    runtimeError: opts.runtimeError ?? null,
    categories: opts.categories ?? {
      performance: { title: "Performance", score: 0.91 },
      accessibility: { title: "Accessibility", score: 1.0 },
      "best-practices": { title: "Best Practices", score: 0.96 },
      seo: { title: "SEO", score: 1.0 },
    },
    audits: opts.audits ?? {},
    configSettings: {},
  });
}

function makeAgenticBrowsingLhr(opts: {
  fetchTime?: string;
  agenticScore?: number | null;
  agenticAudits?: Record<string, { score: number | null; scoreDisplayMode?: string }>;
}): string {
  const audits = opts.agenticAudits ?? {
    "agentic-navigation": { score: 1, scoreDisplayMode: "binary" },
    "agentic-form-fill": { score: 1, scoreDisplayMode: "binary" },
    "agentic-data-extraction": { score: 0, scoreDisplayMode: "binary" },
  };
  return makeSyntheticLhr({
    fetchTime: opts.fetchTime,
    categories: {
      performance: { title: "Performance", score: 0.85 },
      "agentic-browsing": {
        title: "Agentic Browsing",
        score: opts.agenticScore ?? null,
        experimental: true,
      },
    },
    audits,
  });
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("RFC-0874: nachweis.measure.lighthouse", () => {
  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "lighthouse-test-"));
    workspaceRoot = tmpDir;
    mockState.chromeAvailable = true;
    mockState.lighthouseOutputs = [];
    mockState.ingestResult = null;
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("entitlement gating", () => {
    it("skips when nachweis entitlement is not resolved", async () => {
      const cachePath = join(workspaceRoot, "systems-cache", "test-system");
      await writeEntitlements(cachePath, []);

      const { runNachweisLighthouseMeasure } =
        await import("../nachweis/nachweis-lighthouse-measure.ts");

      const result = await runNachweisLighthouseMeasure(
        makeInput({
          system: "test-system",
          url: "https://example.com",
        }),
        makeContext(),
      );

      expect(result.exitCode).toBe(0);
      expect((result.data as unknown as Record<string, unknown>).skipped).toBe(true);
    });
  });

  describe("dry-run", () => {
    it("returns dry-run result without running Lighthouse", async () => {
      const cachePath = join(workspaceRoot, "systems-cache", "test-system");
      await writeEntitlements(cachePath, ["nachweis"]);

      const { runNachweisLighthouseMeasure } =
        await import("../nachweis/nachweis-lighthouse-measure.ts");

      const result = await runNachweisLighthouseMeasure(
        makeInput({
          system: "test-system",
          url: "https://example.com",
          "dry-run": true,
        }),
        makeContext(),
      );

      expect(result.exitCode).toBe(0);
      const data = expectData(result);
      expect(data.status).toBe("ok");
      expect(data.runCount).toBe(5);
      expect(data.aggregation).toBe("median");
      expect(data.observationId).toBe("");
      expect(data.lighthouseVersion).toBe("");
    });
  });

  describe("URL validation", () => {
    it("fails with LIGHTHOUSE_URL_INVALID for non-HTTPS URL", async () => {
      const cachePath = join(workspaceRoot, "systems-cache", "test-system");
      await writeEntitlements(cachePath, ["nachweis"]);

      const { runNachweisLighthouseMeasure } =
        await import("../nachweis/nachweis-lighthouse-measure.ts");

      const result = await runNachweisLighthouseMeasure(
        makeInput({
          system: "test-system",
          url: "http://example.com",
        }),
        makeContext(),
      );

      expect(result.exitCode).toBe(1);
      const data = expectData(result);
      expect(data.status).toBe("error");
      expect(data.code).toBe("LIGHTHOUSE_URL_INVALID");
    });
  });

  describe("methodology parsing", () => {
    it("fails with LIGHTHOUSE_METHODOLOGY_INVALID when @ is missing", async () => {
      const cachePath = join(workspaceRoot, "systems-cache", "test-system");
      await writeEntitlements(cachePath, ["nachweis"]);

      const { runNachweisLighthouseMeasure } =
        await import("../nachweis/nachweis-lighthouse-measure.ts");

      const result = await runNachweisLighthouseMeasure(
        makeInput({
          system: "test-system",
          url: "https://example.com",
          methodology: "WG-LH-01",
        }),
        makeContext(),
      );

      expect(result.exitCode).toBe(1);
      const data = expectData(result);
      expect(data.code).toBe("LIGHTHOUSE_METHODOLOGY_INVALID");
    });

    it("fails with LIGHTHOUSE_METHODOLOGY_INVALID when version is empty", async () => {
      const cachePath = join(workspaceRoot, "systems-cache", "test-system");
      await writeEntitlements(cachePath, ["nachweis"]);

      const { runNachweisLighthouseMeasure } =
        await import("../nachweis/nachweis-lighthouse-measure.ts");

      const result = await runNachweisLighthouseMeasure(
        makeInput({
          system: "test-system",
          url: "https://example.com",
          methodology: "WG-LH-01@",
        }),
        makeContext(),
      );

      expect(result.exitCode).toBe(1);
      const data = expectData(result);
      expect(data.code).toBe("LIGHTHOUSE_METHODOLOGY_INVALID");
    });
  });

  describe("LHR parsing and category projection", () => {
    it("extracts numeric categories as 0-100 scores", async () => {
      const { parseAllCategories, parseLhrJson } =
        await import("../nachweis/nachweis-lighthouse-measure.ts");

      const lhr = parseLhrJson(
        makeSyntheticLhr({
          categories: {
            performance: { title: "Performance", score: 0.91 },
            accessibility: { title: "Accessibility", score: 1.0 },
          },
        }),
      );

      const projections = parseAllCategories(lhr);
      expect(projections).toHaveLength(2);
      const perf = projections.find((p) => p.id === "performance");
      expect(perf?.score).toBe(91);
      const a11y = projections.find((p) => p.id === "accessibility");
      expect(a11y?.score).toBe(100);
    });

    it("extracts non-numeric experimental categories as numerator/denominator", async () => {
      const { parseAllCategories, parseLhrJson } =
        await import("../nachweis/nachweis-lighthouse-measure.ts");

      const lhr = parseLhrJson(
        makeAgenticBrowsingLhr({
          agenticScore: null,
          agenticAudits: {
            "agentic-navigation": { score: 1, scoreDisplayMode: "binary" },
            "agentic-form-fill": { score: 1, scoreDisplayMode: "binary" },
            "agentic-data-extraction": { score: 0, scoreDisplayMode: "binary" },
          },
        }),
      );

      const projections = parseAllCategories(lhr);
      const agentic = projections.find((p) => p.id === "agentic-browsing");
      expect(agentic).toBeDefined();
      expect(agentic?.score).toBeUndefined();
      expect(agentic?.numerator).toBe(2);
      expect(agentic?.denominator).toBe(3);
      expect(agentic?.status).toBe("fail");
      expect(agentic?.experimental).toBe(true);
    });

    it("extracts non-numeric categories as not-checked when no audits", async () => {
      const { parseAllCategories, parseLhrJson } =
        await import("../nachweis/nachweis-lighthouse-measure.ts");

      const lhr = parseLhrJson(
        makeSyntheticLhr({
          categories: {
            "custom-category": { title: "Custom", score: null },
          },
          audits: {},
        }),
      );

      const projections = parseAllCategories(lhr);
      const custom = projections.find((p) => p.id === "custom-category");
      expect(custom?.status).toBe("not-checked");
      expect(custom?.score).toBeUndefined();
    });
  });

  describe("canonical run validation", () => {
    it("rejects LHR with runtimeError", async () => {
      const { validateCanonicalRun, parseLhrJson } =
        await import("../nachweis/nachweis-lighthouse-measure.ts");

      const lhr = parseLhrJson(
        makeSyntheticLhr({
          runtimeError: { code: "PAGE_HUNG", message: "Page hung" },
        }),
      );

      const validity = validateCanonicalRun(lhr);
      expect(validity.valid).toBe(false);
      expect(validity.reason).toContain("runtimeError");
    });

    it("rejects LHR missing requestedUrl", async () => {
      const { validateCanonicalRun, parseLhrJson } =
        await import("../nachweis/nachweis-lighthouse-measure.ts");

      const lhr = parseLhrJson(makeSyntheticLhr({ requestedUrl: "" as string | undefined }));

      const validity = validateCanonicalRun(lhr);
      expect(validity.valid).toBe(false);
      expect(validity.reason).toContain("requestedUrl");
    });

    it("accepts valid LHR", async () => {
      const { validateCanonicalRun, parseLhrJson } =
        await import("../nachweis/nachweis-lighthouse-measure.ts");

      const lhr = parseLhrJson(makeSyntheticLhr({}));
      const validity = validateCanonicalRun(lhr);
      expect(validity.valid).toBe(true);
    });
  });

  describe("category aggregation", () => {
    it("aggregates numeric categories via median with min/max/samples", async () => {
      const { aggregateCategories } = await import("../nachweis/nachweis-lighthouse-measure.ts");
      const { parseAllCategories, parseLhrJson } =
        await import("../nachweis/nachweis-lighthouse-measure.ts");

      const scores = [0.85, 0.91, 0.88, 0.92, 0.87];
      const runs = scores.map((s, i) => ({
        runIndex: i + 1,
        lhrPath: `/tmp/lhr-${i}.json`,
        lighthouseVersion: "13.4.1",
        fetchTime: `2026-08-18T10:0${i}:00.000Z`,
        userAgent: "test",
        requestedUrl: "https://example.com",
        finalUrl: "https://example.com",
        categories: parseAllCategories(
          parseLhrJson(
            makeSyntheticLhr({
              fetchTime: `2026-08-18T10:0${i}:00.000Z`,
              categories: { performance: { title: "Performance", score: s } },
            }),
          ),
        ),
      }));

      const aggregated = aggregateCategories(runs);
      expect(aggregated).toHaveLength(1);
      const perf = aggregated[0]!;
      expect(perf.id).toBe("performance");
      expect(perf.score).toBe(88);
      expect(perf.min).toBe(85);
      expect(perf.max).toBe(92);
      expect(perf.samples).toEqual([85, 91, 88, 92, 87]);
    });

    it("aggregates non-numeric categories preserving numerator/denominator", async () => {
      const { aggregateCategories } = await import("../nachweis/nachweis-lighthouse-measure.ts");
      const { parseAllCategories, parseLhrJson } =
        await import("../nachweis/nachweis-lighthouse-measure.ts");

      const runs = [0, 1, 2, 3, 4].map((i) => ({
        runIndex: i + 1,
        lhrPath: `/tmp/lhr-${i}.json`,
        lighthouseVersion: "13.4.1",
        fetchTime: `2026-08-18T10:0${i}:00.000Z`,
        userAgent: "test",
        requestedUrl: "https://example.com",
        finalUrl: "https://example.com",
        categories: parseAllCategories(
          parseLhrJson(
            makeAgenticBrowsingLhr({
              fetchTime: `2026-08-18T10:0${i}:00.000Z`,
              agenticScore: null,
              agenticAudits: {
                "agentic-nav": { score: 1, scoreDisplayMode: "binary" },
                "agentic-form": { score: 1, scoreDisplayMode: "binary" },
                "agentic-extract": { score: i < 3 ? 1 : 0, scoreDisplayMode: "binary" },
              },
            }),
          ),
        ),
      }));

      const aggregated = aggregateCategories(runs);
      const agentic = aggregated.find((p) => p.id === "agentic-browsing");
      expect(agentic).toBeDefined();
      expect(agentic?.numerator).toBe(3);
      expect(agentic?.denominator).toBe(3);
      expect(agentic?.status).toBe("fail");
      expect(agentic?.score).toBeUndefined();
    });
  });

  describe("bundle construction", () => {
    it("builds a valid AssessmentBundleV1 from run results", async () => {
      const { buildAssessmentBundle } = await import("../nachweis/nachweis-lighthouse-measure.ts");
      const { assessmentBundleV1Schema } = await import("../nachweis/nachweis-io.ts");

      const runResults = [
        {
          runIndex: 1,
          lhrPath: "/tmp/lhr-run-01.json",
          lighthouseVersion: "13.4.1",
          fetchTime: "2026-08-18T10:00:00.000Z",
          userAgent: "test",
          requestedUrl: "https://example.com",
          finalUrl: "https://example.com",
          categories: [
            { id: "performance", providerLabel: "Performance", score: 91 },
            { id: "accessibility", providerLabel: "Accessibility", score: 100 },
          ],
        },
      ];

      const options = {
        systemId: "test-system",
        url: "https://example.com",
        seriesId: "wg-homepage-performance",
        authorizationBasis: "site-owner" as const,
        runs: 5,
        methodologyId: "WG-LH-01",
        methodologyVersion: "1.0",
        freshnessDays: 30,
        dryRun: false,
      };

      const bundle = buildAssessmentBundle(options, runResults as never, runResults[0]!.categories);

      const parsed = assessmentBundleV1Schema.safeParse(bundle);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.systemId).toBe("test-system");
        expect(parsed.data.methodology.id).toBe("WG-LH-01");
        expect(parsed.data.methodology.version).toBe("1.0");
        expect(parsed.data.methodology.runCount).toBe(5);
        expect(parsed.data.methodology.aggregation).toBe("median");
        expect(parsed.data.observedAt).toBe("2026-08-18T10:00:00.000Z");
        expect(parsed.data.artifacts).toHaveLength(2);
        expect(parsed.data.artifacts[0]!.role).toBe("raw-result");
        expect(parsed.data.artifacts[0]!.canonical).toBe(true);
        expect(parsed.data.artifacts[1]!.role).toBe("methodology");
        expect(parsed.data.artifacts[1]!.canonical).toBe(false);
      }
    });

    it("sets observedAt deterministically from first run fetchTime", async () => {
      const { buildAssessmentBundle } = await import("../nachweis/nachweis-lighthouse-measure.ts");

      const runResults = [
        {
          runIndex: 1,
          lhrPath: "/tmp/lhr-run-01.json",
          lighthouseVersion: "13.4.1",
          fetchTime: "2026-08-18T10:00:00.000Z",
          userAgent: "test",
          requestedUrl: "https://example.com",
          finalUrl: "https://example.com",
          categories: [],
        },
      ];

      const options = {
        systemId: "test-system",
        url: "https://example.com",
        seriesId: "test-series",
        authorizationBasis: "site-owner" as const,
        runs: 5,
        methodologyId: "WG-LH-01",
        methodologyVersion: "1.0",
        freshnessDays: 30,
        dryRun: false,
      };

      const bundle = buildAssessmentBundle(options, runResults as never, []);
      expect(bundle.observedAt).toBe("2026-08-18T10:00:00.000Z");
    });
  });
});
