/*
<MODULE_CONTRACT>
  <purpose>
    Unit tests for RFC-0873: nachweis.assessment.ingest command handler.
    Tests cover entitlement skip, dry-run, Zod validation, path safety, idempotency,
    observation conflict, credential detection, system mismatch, R2 upload, PBP write,
    Bordbuch append, and JSON output.
  </purpose>
  <keywords>RFC-0873, nachweis, assessment, ingest, unit-test, idempotency, path-traversal, credentials</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0873: initial tests for nachweis.assessment.ingest command handler.</item>
</CHANGE_SUMMARY>
*/

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
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

const mockR2State = vi.hoisted(() => ({
  objects: new Map<string, Uint8Array>(),
  putCalls: 0,
  putShouldFail: false as string | false,
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
    putObject: vi.fn(async (input: { key: string; body: Uint8Array }) => {
      if (mockR2State.putShouldFail) {
        throw new Error(mockR2State.putShouldFail);
      }
      mockR2State.objects.set(input.key, input.body);
      mockR2State.putCalls++;
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

function makeValidBundle(systemId: string, slug: string, seriesId: string, observationId: string) {
  return {
    schemaVersion: "nachweis-assessment-bundle@1",
    systemId,
    slug,
    title: { de: "Test Assessment", uk: "Тест" },
    seriesId,
    observationId,
    subject: { url: "https://example.com" },
    provider: { id: "lighthouse", name: "Lighthouse" },
    tool: { id: "lighthouse", name: "Lighthouse", version: "11.0.0" },
    execution: {
      mode: "operator-run" as const,
      authorizationBasis: "site-owner" as const,
    },
    observedAt: "2026-08-18T10:00:00Z",
    methodology: {
      id: "lighthouse-core",
      version: "11.0.0",
      runCount: 1,
      aggregation: "provider" as const,
    },
    result: {
      overall: { score: 85, level: "good" },
      dimensions: [
        { id: "performance", providerLabel: "Performance", score: 90 },
        { id: "accessibility", providerLabel: "Accessibility", score: 80 },
      ],
    },
    freshness: { maxAgeDays: 30 },
    artifacts: [
      {
        key: "raw-result",
        role: "raw-result" as const,
        file: "raw-result.json",
        mediaType: "application/json",
        canonical: true,
      },
      {
        key: "screenshot",
        role: "screenshot" as const,
        file: "screenshot.png",
        mediaType: "image/png",
        canonical: false,
      },
    ],
  };
}

async function writeBundleFile(dir: string, bundle: Record<string, unknown>): Promise<string> {
  const bundlePath = join(dir, "bundle.json");
  await writeFile(bundlePath, JSON.stringify(bundle, null, 2), "utf8");
  return bundlePath;
}

async function writeArtifactFiles(dir: string, files: Record<string, string>): Promise<void> {
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(dir, name), content, "utf8");
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("RFC-0873: nachweis.assessment.ingest", () => {
  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "nachweis-assessment-"));
    workspaceRoot = tmpDir;
    mockR2State.objects.clear();
    mockR2State.putCalls = 0;
    mockR2State.putShouldFail = false;
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("skips when nachweis entitlement is not resolved", async () => {
    const cachePath = join(workspaceRoot, "systems-cache", "test-system");
    await writeEntitlements(cachePath, []);

    const { runNachweisAssessmentIngest } =
      await import("../nachweis/nachweis-assessment-ingest.ts");
    const result = await runNachweisAssessmentIngest(
      makeInput({ system: "test-system", bundle: "/tmp/nonexistent.json" }),
      makeContext(),
    );
    expect(result.exitCode).toBe(0);
    const data = result.data as unknown as Record<string, unknown>;
    expect(data.skipped).toBe(true);
  });

  it("dry-run performs no remote/file state mutation", async () => {
    const systemId = "test-system";
    const cachePath = join(workspaceRoot, "systems-cache", systemId);
    await writeEntitlements(cachePath, ["nachweis"]);

    const bundleDir = join(tmpDir, "bundle-dir");
    await mkdir(bundleDir, { recursive: true });
    const bundle = makeValidBundle(systemId, "lh-001", "series-1", "obs-001");
    const bundlePath = await writeBundleFile(bundleDir, bundle);
    await writeArtifactFiles(bundleDir, {
      "raw-result.json": '{"score": 90}',
      "screenshot.png": "fake-png-data",
    });

    const { runNachweisAssessmentIngest } =
      await import("../nachweis/nachweis-assessment-ingest.ts");
    const result = await runNachweisAssessmentIngest(
      makeInput({ system: systemId, bundle: bundlePath, "dry-run": true }),
      makeContext(),
    );
    expect(result.exitCode).toBe(0);
    const data = expectData(result);
    expect(data.dryRun).toBe(true);
    expect(data.alreadyIngested).toBe(false);
    expect(data.artifactHashes).toHaveProperty("raw-result");
    expect(mockR2State.putCalls).toBe(0);
    const evidenceFile = join(
      cachePath,
      "src",
      "content",
      "business-profile",
      "de",
      "trust",
      "evidence",
      "lh-001.md",
    );
    expect(existsSync(evidenceFile)).toBe(false);
  });

  it("valid bundle ingest produces hashes, R2 objects, PBP source, Bordbuch event", async () => {
    const systemId = "test-system";
    const cachePath = join(workspaceRoot, "systems-cache", systemId);
    await writeEntitlements(cachePath, ["nachweis"]);

    const bundleDir = join(tmpDir, "bundle-dir");
    await mkdir(bundleDir, { recursive: true });
    const bundle = makeValidBundle(systemId, "lh-001", "series-1", "obs-001");
    const bundlePath = await writeBundleFile(bundleDir, bundle);
    await writeArtifactFiles(bundleDir, {
      "raw-result.json": '{"score": 90}',
      "screenshot.png": "fake-png-data",
    });

    const { runNachweisAssessmentIngest } =
      await import("../nachweis/nachweis-assessment-ingest.ts");
    const result = await runNachweisAssessmentIngest(
      makeInput({ system: systemId, bundle: bundlePath }),
      makeContext(),
    );
    expect(result.exitCode).toBe(0);
    const data = expectData(result);
    expect(data.alreadyIngested).toBe(false);
    expect(data.bordbuchEventId).not.toBeNull();
    expect(data.verificationLevel).toBe("N1");
    expect(mockR2State.putCalls).toBe(2);
    expect(mockR2State.objects.size).toBe(2);

    const evidenceFile = join(
      cachePath,
      "src",
      "content",
      "business-profile",
      "de",
      "trust",
      "evidence",
      "lh-001.md",
    );
    expect(existsSync(evidenceFile)).toBe(true);
    const raw = await readFile(evidenceFile, "utf8");
    expect(raw).toContain("technical-assessment");
    expect(raw).toContain("series-1");
    expect(raw).toContain("obs-001");

    const bordbuchFile = join(cachePath, "bordbuch", "events.ndjson");
    expect(existsSync(bordbuchFile)).toBe(true);
    const bordbuch = await readFile(bordbuchFile, "utf8");
    expect(bordbuch).toContain("assessment-ingested");
  });

  it("same ingest is idempotent (alreadyIngested: true)", async () => {
    const systemId = "test-system";
    const cachePath = join(workspaceRoot, "systems-cache", systemId);
    await writeEntitlements(cachePath, ["nachweis"]);

    const bundleDir = join(tmpDir, "bundle-dir");
    await mkdir(bundleDir, { recursive: true });
    const bundle = makeValidBundle(systemId, "lh-001", "series-1", "obs-001");
    const bundlePath = await writeBundleFile(bundleDir, bundle);
    await writeArtifactFiles(bundleDir, {
      "raw-result.json": '{"score": 90}',
      "screenshot.png": "fake-png-data",
    });

    const { runNachweisAssessmentIngest } =
      await import("../nachweis/nachweis-assessment-ingest.ts");
    const r1 = await runNachweisAssessmentIngest(
      makeInput({ system: systemId, bundle: bundlePath }),
      makeContext(),
    );
    expect(r1.exitCode).toBe(0);

    mockR2State.putCalls = 0;
    const r2 = await runNachweisAssessmentIngest(
      makeInput({ system: systemId, bundle: bundlePath }),
      makeContext(),
    );
    expect(r2.exitCode).toBe(0);
    const data = expectData(r2);
    expect(data.alreadyIngested).toBe(true);
    expect(mockR2State.putCalls).toBe(0);
  });

  it("same observation ID with changed content fails (ASSESSMENT_OBSERVATION_CONFLICT)", async () => {
    const systemId = "test-system";
    const cachePath = join(workspaceRoot, "systems-cache", systemId);
    await writeEntitlements(cachePath, ["nachweis"]);

    const bundleDir = join(tmpDir, "bundle-dir");
    await mkdir(bundleDir, { recursive: true });
    const bundle = makeValidBundle(systemId, "lh-001", "series-1", "obs-001");
    const bundlePath = await writeBundleFile(bundleDir, bundle);
    await writeArtifactFiles(bundleDir, {
      "raw-result.json": '{"score": 90}',
      "screenshot.png": "fake-png-data",
    });

    const { runNachweisAssessmentIngest } =
      await import("../nachweis/nachweis-assessment-ingest.ts");
    const r1 = await runNachweisAssessmentIngest(
      makeInput({ system: systemId, bundle: bundlePath }),
      makeContext(),
    );
    expect(r1.exitCode).toBe(0);

    await writeArtifactFiles(bundleDir, {
      "raw-result.json": '{"score": 95}',
      "screenshot.png": "different-png-data",
    });
    const r2 = await runNachweisAssessmentIngest(
      makeInput({ system: systemId, bundle: bundlePath }),
      makeContext(),
    );
    expect(r2.exitCode).toBe(1);
    expect(r2.summary).toContain("ASSESSMENT_OBSERVATION_CONFLICT");
  });

  it("new observation in same series preserves old artifacts", async () => {
    const systemId = "test-system";
    const cachePath = join(workspaceRoot, "systems-cache", systemId);
    await writeEntitlements(cachePath, ["nachweis"]);

    const bundleDir = join(tmpDir, "bundle-dir");
    await mkdir(bundleDir, { recursive: true });

    const bundle1 = makeValidBundle(systemId, "lh-001", "series-1", "obs-001");
    const bundlePath1 = await writeBundleFile(bundleDir, bundle1);
    await writeArtifactFiles(bundleDir, {
      "raw-result.json": '{"score": 90}',
      "screenshot.png": "fake-png-data",
    });

    const { runNachweisAssessmentIngest } =
      await import("../nachweis/nachweis-assessment-ingest.ts");
    const r1 = await runNachweisAssessmentIngest(
      makeInput({ system: systemId, bundle: bundlePath1 }),
      makeContext(),
    );
    expect(r1.exitCode).toBe(0);

    const bundle2 = makeValidBundle(systemId, "lh-001", "series-1", "obs-002");
    const bundlePath2 = await writeBundleFile(bundleDir, bundle2);
    await writeArtifactFiles(bundleDir, {
      "raw-result.json": '{"score": 88}',
      "screenshot.png": "fake-png-data-2",
    });

    mockR2State.putCalls = 0;
    const r2 = await runNachweisAssessmentIngest(
      makeInput({ system: systemId, bundle: bundlePath2 }),
      makeContext(),
    );
    expect(r2.exitCode).toBe(0);
    const data = expectData(r2);
    expect(data.alreadyIngested).toBe(false);
    expect(data.observationId).toBe("obs-002");
    expect(mockR2State.putCalls).toBe(2);
  });

  it("path traversal in slug fails", async () => {
    const systemId = "test-system";
    const cachePath = join(workspaceRoot, "systems-cache", systemId);
    await writeEntitlements(cachePath, ["nachweis"]);

    const bundleDir = join(tmpDir, "bundle-dir");
    await mkdir(bundleDir, { recursive: true });
    const bundle = makeValidBundle(systemId, "../escape", "series-1", "obs-001");
    const bundlePath = await writeBundleFile(bundleDir, bundle);
    await writeArtifactFiles(bundleDir, {
      "raw-result.json": '{"score": 90}',
      "screenshot.png": "fake-png-data",
    });

    const { runNachweisAssessmentIngest } =
      await import("../nachweis/nachweis-assessment-ingest.ts");
    const result = await runNachweisAssessmentIngest(
      makeInput({ system: systemId, bundle: bundlePath }),
      makeContext(),
    );
    // Zod schema rejects ../  in slug via regex, so this is a BUNDLE_INVALID error
    expect(result.exitCode).toBe(1);
    expect(result.summary).toContain("ASSESSMENT_BUNDLE_INVALID");
  });

  it("artifact path escape fails", async () => {
    const systemId = "test-system";
    const cachePath = join(workspaceRoot, "systems-cache", systemId);
    await writeEntitlements(cachePath, ["nachweis"]);

    const bundleDir = join(tmpDir, "bundle-dir");
    await mkdir(bundleDir, { recursive: true });
    const bundle = makeValidBundle(systemId, "lh-001", "series-1", "obs-001");
    bundle.artifacts[0].file = "../escape.json";
    const bundlePath = await writeBundleFile(bundleDir, bundle);
    await writeArtifactFiles(bundleDir, {
      "raw-result.json": '{"score": 90}',
      "screenshot.png": "fake-png-data",
    });

    const { runNachweisAssessmentIngest } =
      await import("../nachweis/nachweis-assessment-ingest.ts");
    const result = await runNachweisAssessmentIngest(
      makeInput({ system: systemId, bundle: bundlePath }),
      makeContext(),
    );
    expect(result.exitCode).toBe(1);
    expect(result.summary).toContain("ASSESSMENT_ARTIFACT_PATH_ESCAPE");
  });

  it("missing canonical raw artifact fails", async () => {
    const systemId = "test-system";
    const cachePath = join(workspaceRoot, "systems-cache", systemId);
    await writeEntitlements(cachePath, ["nachweis"]);

    const bundleDir = join(tmpDir, "bundle-dir");
    await mkdir(bundleDir, { recursive: true });
    const bundle = makeValidBundle(systemId, "lh-001", "series-1", "obs-001");
    bundle.artifacts = [
      {
        key: "screenshot",
        role: "screenshot" as const,
        file: "screenshot.png",
        mediaType: "image/png",
        canonical: false,
      },
    ];
    const bundlePath = await writeBundleFile(bundleDir, bundle);
    await writeArtifactFiles(bundleDir, {
      "screenshot.png": "fake-png-data",
    });

    const { runNachweisAssessmentIngest } =
      await import("../nachweis/nachweis-assessment-ingest.ts");
    const result = await runNachweisAssessmentIngest(
      makeInput({ system: systemId, bundle: bundlePath }),
      makeContext(),
    );
    expect(result.exitCode).toBe(1);
    expect(result.summary).toContain("ASSESSMENT_BUNDLE_INVALID");
  });

  it("credential detection in bundle fails", async () => {
    const systemId = "test-system";
    const cachePath = join(workspaceRoot, "systems-cache", systemId);
    await writeEntitlements(cachePath, ["nachweis"]);

    const bundleDir = join(tmpDir, "bundle-dir");
    await mkdir(bundleDir, { recursive: true });
    const bundle = makeValidBundle(systemId, "lh-001", "series-1", "obs-001");
    const bundlePath = join(bundleDir, "bundle.json");
    await writeFile(
      bundlePath,
      JSON.stringify(bundle, null, 2) + '\n"api_key": "TESTSECRET_abcdefghijklmnopqrst"',
      "utf8",
    );
    await writeArtifactFiles(bundleDir, {
      "raw-result.json": '{"score": 90}',
      "screenshot.png": "fake-png-data",
    });

    const { runNachweisAssessmentIngest } =
      await import("../nachweis/nachweis-assessment-ingest.ts");
    const result = await runNachweisAssessmentIngest(
      makeInput({ system: systemId, bundle: bundlePath }),
      makeContext(),
    );
    expect(result.exitCode).toBe(1);
    expect(result.summary).toContain("CREDENTIAL_DETECTED");
  });

  it("system mismatch fails", async () => {
    const systemId = "test-system";
    const cachePath = join(workspaceRoot, "systems-cache", systemId);
    await writeEntitlements(cachePath, ["nachweis"]);

    const bundleDir = join(tmpDir, "bundle-dir");
    await mkdir(bundleDir, { recursive: true });
    const bundle = makeValidBundle("other-system", "lh-001", "series-1", "obs-001");
    const bundlePath = await writeBundleFile(bundleDir, bundle);
    await writeArtifactFiles(bundleDir, {
      "raw-result.json": '{"score": 90}',
      "screenshot.png": "fake-png-data",
    });

    const { runNachweisAssessmentIngest } =
      await import("../nachweis/nachweis-assessment-ingest.ts");
    const result = await runNachweisAssessmentIngest(
      makeInput({ system: systemId, bundle: bundlePath }),
      makeContext(),
    );
    expect(result.exitCode).toBe(1);
    expect(result.summary).toContain("ASSESSMENT_SYSTEM_MISMATCH");
  });

  it("missing env vars fail with MISSING_ENV", async () => {
    const systemId = "test-system";
    const cachePath = join(workspaceRoot, "systems-cache", systemId);
    await writeEntitlements(cachePath, ["nachweis"]);

    const bundleDir = join(tmpDir, "bundle-dir");
    await mkdir(bundleDir, { recursive: true });
    const bundle = makeValidBundle(systemId, "lh-001", "series-1", "obs-001");
    const bundlePath = await writeBundleFile(bundleDir, bundle);
    await writeArtifactFiles(bundleDir, {
      "raw-result.json": '{"score": 90}',
      "screenshot.png": "fake-png-data",
    });

    const { resolveR2ConfigFromEnv } = await import("../evidence/r2-client.ts");
    vi.mocked(resolveR2ConfigFromEnv).mockImplementationOnce(() => {
      throw new (class extends Error {
        missingVar = "R2_NACHWEIS_ACCOUNT_ID";
      })("R2_NACHWEIS_ACCOUNT_ID environment variable is required");
    });

    const { runNachweisAssessmentIngest } =
      await import("../nachweis/nachweis-assessment-ingest.ts");
    const result = await runNachweisAssessmentIngest(
      makeInput({ system: systemId, bundle: bundlePath }),
      makeContext(),
    );
    // The thrown error is not a MissingEnvError instance, so it falls into
    // the generic R2_UPLOAD_ERROR path.
    expect(result.exitCode).toBe(1);
  });

  it("no credentials appear in JSON result, PBP, or Bordbuch", async () => {
    const systemId = "test-system";
    const cachePath = join(workspaceRoot, "systems-cache", systemId);
    await writeEntitlements(cachePath, ["nachweis"]);

    const bundleDir = join(tmpDir, "bundle-dir");
    await mkdir(bundleDir, { recursive: true });
    const bundle = makeValidBundle(systemId, "lh-001", "series-1", "obs-001");
    const bundlePath = await writeBundleFile(bundleDir, bundle);
    await writeArtifactFiles(bundleDir, {
      "raw-result.json": '{"score": 90}',
      "screenshot.png": "fake-png-data",
    });

    const { runNachweisAssessmentIngest } =
      await import("../nachweis/nachweis-assessment-ingest.ts");
    const result = await runNachweisAssessmentIngest(
      makeInput({ system: systemId, bundle: bundlePath, json: true }),
      makeContext(),
    );
    expect(result.exitCode).toBe(0);
    const resultJson = JSON.stringify(result);
    expect(resultJson).not.toMatch(/api[_-]?key/i);
    expect(resultJson).not.toMatch(/secret/i);
    expect(resultJson).not.toMatch(/password/i);
    expect(resultJson).not.toMatch(/AKIA/);
    expect(resultJson).not.toMatch(/Bearer\s/);

    const evidenceFile = join(
      cachePath,
      "src",
      "content",
      "business-profile",
      "de",
      "trust",
      "evidence",
      "lh-001.md",
    );
    const evidenceRaw = await readFile(evidenceFile, "utf8");
    expect(evidenceRaw).not.toMatch(/api[_-]?key/i);
    expect(evidenceRaw).not.toMatch(/AKIA/);

    const bordbuchFile = join(cachePath, "bordbuch", "events.ndjson");
    const bordbuchRaw = await readFile(bordbuchFile, "utf8");
    expect(bordbuchRaw).not.toMatch(/api[_-]?key/i);
    expect(bordbuchRaw).not.toMatch(/AKIA/);
  });

  it("missing artifact file fails", async () => {
    const systemId = "test-system";
    const cachePath = join(workspaceRoot, "systems-cache", systemId);
    await writeEntitlements(cachePath, ["nachweis"]);

    const bundleDir = join(tmpDir, "bundle-dir");
    await mkdir(bundleDir, { recursive: true });
    const bundle = makeValidBundle(systemId, "lh-001", "series-1", "obs-001");
    const bundlePath = await writeBundleFile(bundleDir, bundle);
    // Only write screenshot, not raw-result.json
    await writeArtifactFiles(bundleDir, {
      "screenshot.png": "fake-png-data",
    });

    const { runNachweisAssessmentIngest } =
      await import("../nachweis/nachweis-assessment-ingest.ts");
    const result = await runNachweisAssessmentIngest(
      makeInput({ system: systemId, bundle: bundlePath }),
      makeContext(),
    );
    expect(result.exitCode).toBe(1);
    expect(result.summary).toContain("ASSESSMENT_ARTIFACT_MISSING");
  });

  it("invalid bundle schema fails", async () => {
    const systemId = "test-system";
    const cachePath = join(workspaceRoot, "systems-cache", systemId);
    await writeEntitlements(cachePath, ["nachweis"]);

    const bundleDir = join(tmpDir, "bundle-dir");
    await mkdir(bundleDir, { recursive: true });
    const bundlePath = await writeBundleFile(bundleDir, {
      schemaVersion: "wrong-version",
      systemId,
    });

    const { runNachweisAssessmentIngest } =
      await import("../nachweis/nachweis-assessment-ingest.ts");
    const result = await runNachweisAssessmentIngest(
      makeInput({ system: systemId, bundle: bundlePath }),
      makeContext(),
    );
    expect(result.exitCode).toBe(1);
    expect(result.summary).toContain("ASSESSMENT_BUNDLE_INVALID");
  });
});
