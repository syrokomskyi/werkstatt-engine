/*
<MODULE_CONTRACT>
  <purpose>
    RFC-0651: unit tests for evidence.sync and evidence.fetch command handlers.
    Tests cover dry-run, missing env, invalid evidence, upload, download, list, and --no-raw.
  </purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0651: initial evidence sync and fetch unit tests.</item>
  <item>RFC-1202: upload-manifest dedup tests — AC-1..AC-5, AC-8 + dry-run env fallback + corrupt-manifest recovery.</item>
</CHANGE_SUMMARY>
*/

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  KernelCommandInput,
  KernelRuntimeContext,
  KernelFlagValue,
} from "@warpgogol/werkstatt-engine/kernel";
import { createDefaultIO, createKernelLogger } from "@warpgogol/werkstatt-engine/kernel";
import type {
  EvidenceSyncResult,
  EvidenceFetchResult,
  EvidenceListResult,
} from "../evidence/index.ts";

// ── Mock state ──────────────────────────────────────────────────────────────

const mockR2State = vi.hoisted(() => ({
  objects: new Map<string, Uint8Array>(),
  putCalls: 0,
  getCalls: 0,
  listCalls: 0,
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
    bucketName: "axiom-evidence",
  })),
  createR2Client: vi.fn(() => ({
    putObject: vi.fn(async (input: { key: string; body: Uint8Array }) => {
      if (mockR2State.putShouldFail) {
        throw new Error(mockR2State.putShouldFail);
      }
      mockR2State.objects.set(input.key, input.body);
      mockR2State.putCalls++;
    }),
    getObject: vi.fn(async (key: string) => {
      mockR2State.getCalls++;
      const body = mockR2State.objects.get(key);
      if (!body) {
        const err = new Error(`NoSuchKey: ${key}`);
        (err as { name: string }).name = "NoSuchKey";
        throw err;
      }
      return { key, body };
    }),
    listObjectsV2: vi.fn(async (prefix: string) => {
      mockR2State.listCalls++;
      const results: Array<{ key: string; size: number }> = [];
      for (const [key, body] of mockR2State.objects) {
        if (key.startsWith(prefix)) {
          results.push({ key, size: body.byteLength });
        }
      }
      return results;
    }),
    rawClient: {},
  })),
}));

// Mock registry-io to return test systems
vi.mock("../sternsystem/registry-io.ts", () => ({
  discoverSystems: vi.fn(async () => ({
    systems: [
      {
        schemaVersion: "system-config/v1",
        id: "warpgogol-com",
        cosmicStar: "Vega",
        mirrors: [],
        pinnedPlatform: "4.5.0",
        status: "active",
        registeredAt: "2026-07-13T00:00:00.000Z",
        notes: "",
      },
    ],
  })),
  readSystemState: vi.fn(async () => ({
    schemaVersion: "system-state/v1",
    systemId: "warpgogol-com",
    currentMission: "warpgogol-com-m000025",
    lastRelease: null,
  })),
}));

import { runEvidenceSync } from "../evidence/evidence-sync.ts";
import { runEvidenceFetch } from "../evidence/evidence-fetch.ts";
import { MissingEnvError } from "../evidence/r2-client.ts";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeInput(flags: Record<string, KernelFlagValue>): KernelCommandInput {
  return { argv: [], flags };
}

function makeContext(workspaceRoot: string): KernelRuntimeContext {
  const { io } = createDefaultIO();
  return {
    workspaceRoot,
    io,
    logger: createKernelLogger("json"),
    dryRun: false,
    siteExplicit: false,
    outputFormat: "json",
    actualState: undefined as never,
  };
}

async function createEvidenceDir(
  workspaceRoot: string,
  missionId: string,
  files: Record<string, string>,
): Promise<string> {
  const missionDir = join(workspaceRoot, "missions", missionId);
  const evidenceDir = join(missionDir, "evidence", "axiom");
  await mkdir(evidenceDir, { recursive: true });
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = join(evidenceDir, relPath);
    await mkdir(join(fullPath, ".."), { recursive: true });
    await writeFile(fullPath, content, "utf8");
  }
  return evidenceDir;
}

function syncData(result: { data?: unknown }): EvidenceSyncResult {
  return result.data as EvidenceSyncResult;
}

function fetchData(result: { data?: unknown }): EvidenceFetchResult {
  return result.data as EvidenceFetchResult;
}

function listData(result: { data?: unknown }): EvidenceListResult {
  return result.data as EvidenceListResult;
}

function evidenceMeta(runTimestamp: string, commitSha?: string): string {
  const meta: Record<string, string> = { auditId: "warpgogol-com-m000025", runTimestamp };
  if (commitSha) meta.commitSha = commitSha;
  return JSON.stringify(meta);
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("evidence.sync (RFC-0651)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "evidence-sync-test-"));
    mockR2State.objects.clear();
    mockR2State.putCalls = 0;
    mockR2State.getCalls = 0;
    mockR2State.listCalls = 0;
    mockR2State.putShouldFail = false;
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("uploads all files to R2 under timestamped key prefix", async () => {
    await createEvidenceDir(tmpDir, "warpgogol-com-m000025", {
      "evidence-metadata.json": evidenceMeta("2026-08-02T13-46-00-000Z", "abc123"),
      "study-run.json": '{"findings": []}',
      "observation-bundle.json": "{}",
      "staged-capsule.json": "{}",
      "report.html": "<html></html>",
      "raw/page-1-axe.json": '{"key": "val"}',
    });

    const result = await runEvidenceSync(
      makeInput({ mission: "warpgogol-com-m000025" }),
      makeContext(tmpDir),
    );

    expect(result.exitCode).toBe(0);
    const data = syncData(result);
    expect(data.r2KeyPrefix).toBe("warpgogol-com/warpgogol-com-m000025/2026-08-02T13-46-00-000Z/");
    expect(data.uploadedFiles).toContain("evidence-metadata.json");
    expect(data.uploadedFiles).toContain("raw/page-1-axe.json");
    // 6 evidence files + the RFC-1202 upload manifest sibling object.
    expect(mockR2State.putCalls).toBe(7);
    expect(data.systemId).toBe("warpgogol-com");
    expect(data.deduped).toBe(false);
  });

  it("--dry-run reports what would be uploaded without R2 API calls", async () => {
    await createEvidenceDir(tmpDir, "warpgogol-com-m000025", {
      "evidence-metadata.json": evidenceMeta("2026-08-02T13-46-00-000Z"),
      "study-run.json": "{}",
    });

    const result = await runEvidenceSync(
      makeInput({ mission: "warpgogol-com-m000025", "dry-run": true }),
      makeContext(tmpDir),
    );

    expect(result.exitCode).toBe(0);
    const data = syncData(result);
    expect(data.uploadedFiles).toContain("evidence-metadata.json");
    expect(data.uploadedFiles).toContain("study-run.json");
    expect(mockR2State.putCalls).toBe(0);
  });

  it("exits 1 with MISSING_ENV when R2_AXIOM_ACCOUNT_ID is not set", async () => {
    const { resolveR2ConfigFromEnv } = await import("../evidence/r2-client.ts");
    vi.mocked(resolveR2ConfigFromEnv).mockImplementationOnce(() => {
      throw new MissingEnvError("R2_AXIOM_ACCOUNT_ID");
    });

    await createEvidenceDir(tmpDir, "warpgogol-com-m000025", {
      "evidence-metadata.json": evidenceMeta("2026-08-02T13-46-00-000Z"),
    });

    const result = await runEvidenceSync(
      makeInput({ mission: "warpgogol-com-m000025" }),
      makeContext(tmpDir),
    );

    expect(result.exitCode).toBe(1);
    expect(result.summary).toContain("MISSING_ENV");
    expect(result.summary).toContain("R2_AXIOM_ACCOUNT_ID");
  });

  it("exits 1 with INVALID_EVIDENCE when evidence-metadata.json is missing runTimestamp", async () => {
    await createEvidenceDir(tmpDir, "warpgogol-com-m000025", {
      "evidence-metadata.json": JSON.stringify({ auditId: "warpgogol-com-m000025" }),
      "study-run.json": "{}",
    });

    await expect(
      runEvidenceSync(makeInput({ mission: "warpgogol-com-m000025" }), makeContext(tmpDir)),
    ).rejects.toThrow("INVALID_EVIDENCE");
  });

  it("exits 1 with NOT_FOUND when evidence directory does not exist", async () => {
    await expect(
      runEvidenceSync(makeInput({ mission: "warpgogol-com-m000025" }), makeContext(tmpDir)),
    ).rejects.toThrow("NOT_FOUND");
  });

  it("uses --run-timestamp flag when provided", async () => {
    await createEvidenceDir(tmpDir, "warpgogol-com-m000025", {
      "evidence-metadata.json": evidenceMeta("2026-08-02T13-46-00-000Z"),
    });

    const result = await runEvidenceSync(
      makeInput({
        mission: "warpgogol-com-m000025",
        "run-timestamp": "2026-08-01T00-00-00-000Z",
      }),
      makeContext(tmpDir),
    );

    expect(result.exitCode).toBe(0);
    const data = syncData(result);
    expect(data.runTimestamp).toBe("2026-08-01T00-00-00-000Z");
    expect(data.r2KeyPrefix).toContain("2026-08-01T00-00-00-000Z/");
  });
});

describe("evidence.sync upload manifest (RFC-1202)", () => {
  let tmpDir: string;
  const TS = "2026-08-02T13-46-00-000Z";
  const MISSION = "warpgogol-com-m000025";
  const manifestKey = `warpgogol-com/${MISSION}/${TS}.upload-manifest.json`;

  const files: Record<string, string> = {
    "evidence-metadata.json": evidenceMeta(TS),
    "study-run.json": "{}",
    "observation-bundle.json": "{}",
  };

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "evidence-manifest-test-"));
    mockR2State.objects.clear();
    mockR2State.putCalls = 0;
    mockR2State.getCalls = 0;
    mockR2State.listCalls = 0;
    mockR2State.putShouldFail = false;
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("AC-2/AC-8: first run uploads all files and writes the manifest strictly last", async () => {
    await createEvidenceDir(tmpDir, MISSION, files);

    const result = await runEvidenceSync(makeInput({ mission: MISSION }), makeContext(tmpDir));

    expect(result.exitCode).toBe(0);
    const data = syncData(result);
    expect(data.deduped).toBe(false);
    expect(data.uploadedFiles).toHaveLength(3);
    // Manifest is the final object written — Map preserves insertion order.
    const keys = [...mockR2State.objects.keys()];
    expect(keys.at(-1)).toBe(manifestKey);
    const stored = JSON.parse(new TextDecoder().decode(mockR2State.objects.get(manifestKey)!)) as {
      files: string[];
      fileCount: number;
      schemaVersion: number;
    };
    expect(stored.schemaVersion).toBe(1);
    expect(stored.fileCount).toBe(3);
    expect(stored.files).toEqual([
      "evidence-metadata.json",
      "observation-bundle.json",
      "study-run.json",
    ]);
  });

  it("AC-1/AC-6: second run against unchanged evidence set dedupes — zero file uploads", async () => {
    await createEvidenceDir(tmpDir, MISSION, files);
    await runEvidenceSync(makeInput({ mission: MISSION }), makeContext(tmpDir));
    const putsAfterFirst = mockR2State.putCalls;

    const result = await runEvidenceSync(makeInput({ mission: MISSION }), makeContext(tmpDir));

    expect(result.exitCode).toBe(0);
    const data = syncData(result);
    expect(data.deduped).toBe(true);
    expect(data.uploadedFiles).toEqual([]);
    expect([...data.skippedFiles].sort()).toEqual(
      ["evidence-metadata.json", "observation-bundle.json", "study-run.json"].sort(),
    );
    expect(mockR2State.putCalls).toBe(putsAfterFirst);
    expect(result.summary).toContain("already archived");
  });

  it("AC-3: interrupted upload writes no manifest; retry uploads the full set", async () => {
    await createEvidenceDir(tmpDir, MISSION, files);

    mockR2State.putShouldFail = "simulated network failure";
    const failed = await runEvidenceSync(makeInput({ mission: MISSION }), makeContext(tmpDir));
    expect(failed.exitCode).toBe(1);
    expect(failed.summary).toContain("R2_UPLOAD_ERROR");
    expect(mockR2State.objects.has(manifestKey)).toBe(false);

    mockR2State.putShouldFail = false;
    const retry = await runEvidenceSync(makeInput({ mission: MISSION }), makeContext(tmpDir));
    expect(retry.exitCode).toBe(0);
    const data = syncData(retry);
    expect(data.deduped).toBe(false);
    expect(data.uploadedFiles).toHaveLength(3);
    expect(mockR2State.objects.has(manifestKey)).toBe(true);
  });

  it("AC-4: diverged manifest file list triggers a full upload and manifest rewrite", async () => {
    await createEvidenceDir(tmpDir, MISSION, files);
    mockR2State.objects.set(
      manifestKey,
      new TextEncoder().encode(
        JSON.stringify({
          schemaVersion: 1,
          missionId: MISSION,
          runTimestamp: TS,
          fileCount: 99,
          totalBytes: 1,
          files: ["stale-file.json"],
          completedAt: "2026-08-02T13:00:00.000Z",
        }),
      ),
    );

    const result = await runEvidenceSync(makeInput({ mission: MISSION }), makeContext(tmpDir));

    expect(result.exitCode).toBe(0);
    const data = syncData(result);
    expect(data.deduped).toBe(false);
    expect(data.uploadedFiles).toHaveLength(3);
    const stored = JSON.parse(new TextDecoder().decode(mockR2State.objects.get(manifestKey)!)) as {
      fileCount: number;
    };
    expect(stored.fileCount).toBe(3);
  });

  it("AC-5: dry-run reports the dedup decision and writes nothing", async () => {
    await createEvidenceDir(tmpDir, MISSION, files);
    await runEvidenceSync(makeInput({ mission: MISSION }), makeContext(tmpDir));
    const putsAfterFirst = mockR2State.putCalls;

    const result = await runEvidenceSync(
      makeInput({ mission: MISSION, "dry-run": true }),
      makeContext(tmpDir),
    );

    expect(result.exitCode).toBe(0);
    const data = syncData(result);
    expect(data.deduped).toBe(true);
    expect(data.skippedFiles).toHaveLength(3);
    expect(result.summary).toContain("dry-run");
    expect(mockR2State.putCalls).toBe(putsAfterFirst);
  });

  it("AC-5: dry-run without manifest reports would-upload and writes nothing", async () => {
    await createEvidenceDir(tmpDir, MISSION, files);

    const result = await runEvidenceSync(
      makeInput({ mission: MISSION, "dry-run": true }),
      makeContext(tmpDir),
    );

    expect(result.exitCode).toBe(0);
    const data = syncData(result);
    expect(data.deduped).toBe(false);
    expect(result.summary).toContain("would be uploaded");
    expect(mockR2State.putCalls).toBe(0);
  });

  it("dry-run with missing R2 env degrades to the plain file listing", async () => {
    const { resolveR2ConfigFromEnv } = await import("../evidence/r2-client.ts");
    vi.mocked(resolveR2ConfigFromEnv).mockImplementationOnce(() => {
      throw new MissingEnvError("R2_AXIOM_ACCOUNT_ID");
    });
    await createEvidenceDir(tmpDir, MISSION, files);

    const result = await runEvidenceSync(
      makeInput({ mission: MISSION, "dry-run": true }),
      makeContext(tmpDir),
    );

    expect(result.exitCode).toBe(0);
    expect(syncData(result).deduped).toBe(false);
    expect(result.summary).toContain("would be uploaded");
  });

  it("corrupt manifest is treated as absent — full upload proceeds", async () => {
    await createEvidenceDir(tmpDir, MISSION, files);
    mockR2State.objects.set(manifestKey, new TextEncoder().encode("not json {"));

    const result = await runEvidenceSync(makeInput({ mission: MISSION }), makeContext(tmpDir));

    expect(result.exitCode).toBe(0);
    expect(syncData(result).deduped).toBe(false);
    expect(syncData(result).uploadedFiles).toHaveLength(3);
  });
});

describe("evidence.fetch (RFC-0651)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "evidence-fetch-test-"));
    mockR2State.objects.clear();
    mockR2State.putCalls = 0;
    mockR2State.getCalls = 0;
    mockR2State.listCalls = 0;
    mockR2State.putShouldFail = false;
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("downloads all files from R2 to output directory", async () => {
    const prefix = "warpgogol-com/warpgogol-com-m000025/2026-08-02T13-46-00-000Z/";
    mockR2State.objects.set(
      prefix + "evidence-metadata.json",
      new TextEncoder().encode(evidenceMeta("2026-08-02T13-46-00-000Z", "abc123")),
    );
    mockR2State.objects.set(
      prefix + "study-run.json",
      new TextEncoder().encode('{"findings": []}'),
    );
    mockR2State.objects.set(prefix + "raw/page-1.json", new TextEncoder().encode('{"page": 1}'));

    const outputDir = join(tmpDir, "output");
    const result = await runEvidenceFetch(
      makeInput({
        mission: "warpgogol-com-m000025",
        "run-timestamp": "2026-08-02T13-46-00-000Z",
        "output-dir": outputDir,
      }),
      makeContext(tmpDir),
    );

    expect(result.exitCode).toBe(0);
    const data = fetchData(result);
    expect(data.downloadedFiles).toContain("evidence-metadata.json");
    expect(data.downloadedFiles).toContain("study-run.json");
    expect(data.downloadedFiles).toContain("raw/page-1.json");
    expect(existsSync(join(outputDir, "evidence-metadata.json"))).toBe(true);
    expect(existsSync(join(outputDir, "raw", "page-1.json"))).toBe(true);
  });

  it("--no-raw skips raw/ artifacts", async () => {
    const prefix = "warpgogol-com/warpgogol-com-m000025/2026-08-02T13-46-00-000Z/";
    mockR2State.objects.set(
      prefix + "evidence-metadata.json",
      new TextEncoder().encode(evidenceMeta("2026-08-02T13-46-00-000Z")),
    );
    mockR2State.objects.set(prefix + "study-run.json", new TextEncoder().encode("{}"));
    mockR2State.objects.set(prefix + "raw/page-1.json", new TextEncoder().encode('{"page": 1}'));

    const outputDir = join(tmpDir, "output");
    const result = await runEvidenceFetch(
      makeInput({
        mission: "warpgogol-com-m000025",
        "run-timestamp": "2026-08-02T13-46-00-000Z",
        "output-dir": outputDir,
        "no-raw": true,
      }),
      makeContext(tmpDir),
    );

    expect(result.exitCode).toBe(0);
    const data = fetchData(result);
    expect(data.downloadedFiles).toContain("evidence-metadata.json");
    expect(data.downloadedFiles).toContain("study-run.json");
    expect(data.downloadedFiles).not.toContain("raw/page-1.json");
    expect(existsSync(join(outputDir, "raw", "page-1.json"))).toBe(false);
  });

  it("--list returns available runs with commitSha", async () => {
    const prefix = "warpgogol-com/warpgogol-com-m000025/";
    const ts1 = "2026-08-02T13-46-00-000Z";
    const ts2 = "2026-08-01T10-00-00-000Z";
    mockR2State.objects.set(
      prefix + ts1 + "/evidence-metadata.json",
      new TextEncoder().encode(evidenceMeta(ts1, "abc123")),
    );
    mockR2State.objects.set(prefix + ts1 + "/study-run.json", new TextEncoder().encode("{}"));
    mockR2State.objects.set(
      prefix + ts2 + "/evidence-metadata.json",
      new TextEncoder().encode(evidenceMeta(ts2)),
    );

    const result = await runEvidenceFetch(
      makeInput({ mission: "warpgogol-com-m000025", list: true }),
      makeContext(tmpDir),
    );

    expect(result.exitCode).toBe(0);
    const data = listData(result);
    expect(data.runs).toHaveLength(2);
    expect(data.runs[0].runTimestamp).toBe(ts1);
    expect(data.runs[0].commitSha).toBe("abc123");
    expect(data.runs[1].runTimestamp).toBe(ts2);
    expect(data.runs[1].commitSha).toBeNull();
  });

  it("exits 1 with NOT_FOUND when run does not exist in R2", async () => {
    const result = await runEvidenceFetch(
      makeInput({
        mission: "warpgogol-com-m000025",
        "run-timestamp": "2026-08-02T13-46-00-000Z",
        "output-dir": join(tmpDir, "output"),
      }),
      makeContext(tmpDir),
    );

    expect(result.exitCode).toBe(1);
    expect(result.summary).toContain("NOT_FOUND");
  });

  it("exits 1 with MISSING_ENV when R2 credentials are not set", async () => {
    const { resolveR2ConfigFromEnv } = await import("../evidence/r2-client.ts");
    vi.mocked(resolveR2ConfigFromEnv).mockImplementationOnce(() => {
      throw new MissingEnvError("R2_AXIOM_ACCOUNT_ID");
    });

    const result = await runEvidenceFetch(
      makeInput({ mission: "warpgogol-com-m000025", list: true }),
      makeContext(tmpDir),
    );

    expect(result.exitCode).toBe(1);
    expect(result.summary).toContain("MISSING_ENV");
  });
});
