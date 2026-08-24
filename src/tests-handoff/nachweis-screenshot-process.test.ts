/*
<MODULE_CONTRACT>
<purpose>Unit tests for RFC-0891 — nachweis.screenshot.process command handler.</purpose>
<keywords>RFC-0891, nachweis, screenshot, process, unit-test, crop, webp</keywords>
<non-goals>
  <item>Does not test sharp image processing — sharp is mocked.</item>
  <item>Does not test R2 network calls — R2 client is mocked.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0891: initial unit test coverage for nachweis.screenshot.process.</item>
</CHANGE_SUMMARY>
*/

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
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
  getCalls: 0,
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
      mockR2State.objects.set(input.key, input.body);
      mockR2State.putCalls++;
    }),
    getObject: vi.fn(async (key: string) => {
      const body = mockR2State.objects.get(key);
      if (!body) {
        throw new Error(`[r2-client] getObject: key not found '${key}'`);
      }
      mockR2State.getCalls++;
      return { key, body };
    }),
  })),
}));

// Mock sharp to return a controlled pipeline
const mockSharpState = vi.hoisted(() => ({
  metadataResult: { width: 3708, height: 27210, format: "png" },
  outputBuffer: Buffer.from("fake-webp-data"),
}));

vi.mock("sharp", () => ({
  default: vi.fn(() => {
    const chain = {
      metadata: vi.fn(async () => mockSharpState.metadataResult),
      extract: vi.fn(() => chain),
      resize: vi.fn(() => chain),
      webp: vi.fn(() => chain),
      toBuffer: vi.fn(async () => mockSharpState.outputBuffer),
    };
    return chain;
  }),
}));

// Mock resolveCacheClonePath to avoid needing system-config.yaml
vi.mock("../sternsystem/registry-io.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../sternsystem/registry-io.ts")>();
  return {
    ...actual,
    resolveCacheClonePath: vi.fn((workspaceRoot: string, systemId: string) => {
      return join(workspaceRoot, "systems-cache", systemId);
    }),
  };
});

// Mock bordbuch-commit-helper
vi.mock("../bordbuch/bordbuch-commit-helper.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../bordbuch/bordbuch-commit-helper.ts")>();
  const { existsSync, readFileSync } = await import("node:fs");
  const fsPromises = await import("node:fs/promises");
  const nodePath = await import("node:path");
  const { createHash } = await import("node:crypto");
  return {
    ...actual,
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
          missionId: (options as { missionId?: string })?.missionId ?? null,
          releaseId: (options as { releaseId?: string })?.releaseId ?? null,
          actor,
          summary,
          metadata: (options as { metadata?: unknown })?.metadata,
          previousHash,
          erratumOf: (options as { erratumOf?: string })?.erratumOf,
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

// Mock executeKernelCommand for bordbuch.validate delegation
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
    "---\ni18n:\n  default: de\n  languages:\n    - de\n---\n",
  );
}

async function writeEntitlements(cachePath: string, features: string[]): Promise<void> {
  const dir = join(cachePath, "src");
  await mkdir(dir, { recursive: true });
  const { stringify: yamlStringify } = await import("yaml");
  await writeFile(join(dir, "entitlements.generated.yaml"), yamlStringify({ features }));
  await writeSystemManifest(cachePath);
}

async function writeEvidenceSource(
  cachePath: string,
  slug: string,
  websiteScreenshot: Record<string, unknown>,
): Promise<void> {
  const dir = join(cachePath, "src", "content", "business-profile", "de", "trust", "evidence");
  await mkdir(dir, { recursive: true });
  const frontmatter = `websiteScreenshot: ${JSON.stringify(websiteScreenshot, null, 2)}`;
  await writeFile(join(dir, `${slug}.md`), `---\n${frontmatter}\n---\n\nContent\n`);
}

async function writeRawScreenshotFile(
  cachePath: string,
  slug: string,
  filename: string,
  content: Buffer,
): Promise<void> {
  const dir = join(cachePath, "trust", "evidence", "screenshots", slug, "raw");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, filename), content);
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("RFC-0891: nachweis.screenshot.process", () => {
  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "nachweis-process-XXXX-"));
    workspaceRoot = tmpDir;
    mockR2State.objects.clear();
    mockR2State.putCalls = 0;
    mockR2State.getCalls = 0;
    mockSharpState.metadataResult = { width: 3708, height: 27210, format: "png" };
    mockSharpState.outputBuffer = Buffer.from("fake-webp-data");
    await writeFile(join(tmpDir, "package.json"), JSON.stringify({ version: "1.0.0" }) + "\n");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("skips silently when nachweis entitlement is not resolved", async () => {
    const { runNachweisScreenshotProcess } =
      await import("../nachweis/nachweis-screenshot-process.ts");
    const result = await runNachweisScreenshotProcess(
      makeInput({ system: "test-sys", slug: "test-slug" }),
      makeContext("test-sys"),
    );
    expect(result.exitCode).toBe(0);
    expect(result.summary).toContain("skipped");
  });

  it("fails when --slug is missing", async () => {
    const { runNachweisScreenshotProcess } =
      await import("../nachweis/nachweis-screenshot-process.ts");
    await expect(
      runNachweisScreenshotProcess(makeInput({ system: "test-sys" }), makeContext("test-sys")),
    ).rejects.toThrow("--slug is required");
  });

  it("fails when evidence-source does not exist", async () => {
    const { runNachweisScreenshotProcess } =
      await import("../nachweis/nachweis-screenshot-process.ts");
    const cachePath = join(workspaceRoot, "systems-cache", "test-sys");
    await writeEntitlements(cachePath, ["nachweis"]);

    await expect(
      runNachweisScreenshotProcess(
        makeInput({ system: "test-sys", slug: "missing-slug" }),
        makeContext("test-sys"),
      ),
    ).rejects.toThrow("NOT_FOUND");
  });

  it("fails when rawArtifact is not present on websiteScreenshot", async () => {
    const { runNachweisScreenshotProcess } =
      await import("../nachweis/nachweis-screenshot-process.ts");
    const cachePath = join(workspaceRoot, "systems-cache", "test-sys");
    await writeEntitlements(cachePath, ["nachweis"]);
    await writeEvidenceSource(cachePath, "test-slug", {});

    await expect(
      runNachweisScreenshotProcess(
        makeInput({ system: "test-sys", slug: "test-slug" }),
        makeContext("test-sys"),
      ),
    ).rejects.toThrow("no rawArtifact found");
  });

  it("dry-run returns crop dimensions without uploading", async () => {
    const { runNachweisScreenshotProcess } =
      await import("../nachweis/nachweis-screenshot-process.ts");
    const cachePath = join(workspaceRoot, "systems-cache", "test-sys");
    await writeEntitlements(cachePath, ["nachweis"]);
    await writeEvidenceSource(cachePath, "test-slug", {
      rawArtifact: {
        sha256: "abc123",
        mediaType: "image/png",
        originalFilename: "screenshot.png",
        width: 3708,
        height: 27210,
        r2Key: "test-sys/screenshots/test-slug/raw/screenshot.png",
        localPath: join(
          cachePath,
          "trust",
          "evidence",
          "screenshots",
          "test-slug",
          "raw",
          "screenshot.png",
        ),
        capturedAt: "2026-08-20T13:44:40Z",
      },
    });
    await writeRawScreenshotFile(cachePath, "test-slug", "screenshot.png", Buffer.from("fake-raw"));

    const result = await runNachweisScreenshotProcess(
      makeInput({ system: "test-sys", slug: "test-slug", "dry-run": true }),
      makeContext("test-sys"),
    );
    const data = expectData(result);

    expect(result.exitCode).toBe(0);
    expect(result.summary).toContain("DRY RUN");
    expect(data.rawDimensions).toEqual({ width: 3708, height: 27210 });
    expect(data.cropRegion.width).toBe(3708);
    expect(data.cropRegion.height).toBe(Math.round((3708 * 9) / 16));
    expect(data.cropRegion.top).toBe(0);
    expect(data.r2Key).toBe("test-sys/screenshots/test-slug/website-screenshot.webp");
    expect(data.capturedAt).toBe("2026-08-20T13:44:40Z");
    expect(data.displaySha256).toBe("");
    expect(mockR2State.putCalls).toBe(0);
  });

  it("happy path: processes, uploads, updates entity, appends Bordbuch", async () => {
    const { runNachweisScreenshotProcess } =
      await import("../nachweis/nachweis-screenshot-process.ts");
    const cachePath = join(workspaceRoot, "systems-cache", "test-sys");
    await writeEntitlements(cachePath, ["nachweis"]);
    await writeEvidenceSource(cachePath, "test-slug", {
      rawArtifact: {
        sha256: "abc123",
        mediaType: "image/png",
        originalFilename: "screenshot.png",
        width: 3708,
        height: 27210,
        r2Key: "test-sys/screenshots/test-slug/raw/screenshot.png",
        localPath: join(
          cachePath,
          "trust",
          "evidence",
          "screenshots",
          "test-slug",
          "raw",
          "screenshot.png",
        ),
        capturedAt: "2026-08-20T13:44:40Z",
      },
    });
    await writeRawScreenshotFile(cachePath, "test-slug", "screenshot.png", Buffer.from("fake-raw"));

    const result = await runNachweisScreenshotProcess(
      makeInput({ system: "test-sys", slug: "test-slug" }),
      makeContext("test-sys"),
    );
    const data = expectData(result);

    expect(result.exitCode).toBe(0);
    expect(data.displayMediaType).toBe("image/webp");
    expect(data.displayWidth).toBe(1280);
    expect(data.displayHeight).toBe(720);
    expect(data.r2Key).toBe("test-sys/screenshots/test-slug/website-screenshot.webp");
    expect(data.capturedAt).toBe("2026-08-20T13:44:40Z");
    expect(data.bordbuchEventId).toMatch(/^event-\d{6}$/);
    expect(mockR2State.putCalls).toBe(1);
    expect(mockR2State.objects.has(data.r2Key)).toBe(true);

    // Verify entity was updated
    const evidenceFile = join(
      cachePath,
      "src",
      "content",
      "business-profile",
      "de",
      "trust",
      "evidence",
      "test-slug.md",
    );
    const raw = await readFile(evidenceFile, "utf8");
    expect(raw).toContain("image/webp");
    expect(raw).toContain("/nachweis-screenshots/test-slug.webp");
    expect(raw).toContain("rawArtifact");
  });

  it("preserves rawArtifact when updating websiteScreenshot", async () => {
    const { runNachweisScreenshotProcess } =
      await import("../nachweis/nachweis-screenshot-process.ts");
    const cachePath = join(workspaceRoot, "systems-cache", "test-sys");
    await writeEntitlements(cachePath, ["nachweis"]);
    await writeEvidenceSource(cachePath, "test-slug", {
      rawArtifact: {
        sha256: "abc123",
        mediaType: "image/png",
        originalFilename: "screenshot.png",
        width: 3708,
        height: 27210,
        r2Key: "test-sys/screenshots/test-slug/raw/screenshot.png",
        localPath: join(
          cachePath,
          "trust",
          "evidence",
          "screenshots",
          "test-slug",
          "raw",
          "screenshot.png",
        ),
        capturedAt: "2026-08-20T13:44:40Z",
      },
    });
    await writeRawScreenshotFile(cachePath, "test-slug", "screenshot.png", Buffer.from("fake-raw"));

    await runNachweisScreenshotProcess(
      makeInput({ system: "test-sys", slug: "test-slug" }),
      makeContext("test-sys"),
    );

    const evidenceFile = join(
      cachePath,
      "src",
      "content",
      "business-profile",
      "de",
      "trust",
      "evidence",
      "test-slug.md",
    );
    const raw = await readFile(evidenceFile, "utf8");
    expect(raw).toContain("rawArtifact:");
    expect(raw).toContain("abc123");
    expect(raw).toContain("screenshot.png");
  });

  it("crop-offset adjusts the vertical crop position", async () => {
    const { runNachweisScreenshotProcess } =
      await import("../nachweis/nachweis-screenshot-process.ts");
    const cachePath = join(workspaceRoot, "systems-cache", "test-sys");
    await writeEntitlements(cachePath, ["nachweis"]);
    await writeEvidenceSource(cachePath, "test-slug", {
      rawArtifact: {
        sha256: "abc123",
        mediaType: "image/png",
        originalFilename: "screenshot.png",
        width: 3708,
        height: 27210,
        r2Key: "test-sys/screenshots/test-slug/raw/screenshot.png",
        localPath: join(
          cachePath,
          "trust",
          "evidence",
          "screenshots",
          "test-slug",
          "raw",
          "screenshot.png",
        ),
      },
    });
    await writeRawScreenshotFile(cachePath, "test-slug", "screenshot.png", Buffer.from("fake-raw"));

    const result = await runNachweisScreenshotProcess(
      makeInput({ system: "test-sys", slug: "test-slug", "dry-run": true, "crop-offset": "200" }),
      makeContext("test-sys"),
    );
    const data = expectData(result);

    expect(data.cropRegion.top).toBe(200);
  });

  it("crop-offset beyond boundary fails with max-offset error", async () => {
    const { runNachweisScreenshotProcess } =
      await import("../nachweis/nachweis-screenshot-process.ts");
    const cachePath = join(workspaceRoot, "systems-cache", "test-sys");
    await writeEntitlements(cachePath, ["nachweis"]);
    await writeEvidenceSource(cachePath, "test-slug", {
      rawArtifact: {
        sha256: "abc123",
        mediaType: "image/png",
        originalFilename: "screenshot.png",
        width: 3708,
        height: 27210,
        r2Key: "test-sys/screenshots/test-slug/raw/screenshot.png",
        localPath: join(
          cachePath,
          "trust",
          "evidence",
          "screenshots",
          "test-slug",
          "raw",
          "screenshot.png",
        ),
      },
    });
    await writeRawScreenshotFile(cachePath, "test-slug", "screenshot.png", Buffer.from("fake-raw"));

    const cropHeight = Math.round((3708 * 9) / 16);
    const maxOffset = 27210 - cropHeight;

    await expect(
      runNachweisScreenshotProcess(
        makeInput({ system: "test-sys", slug: "test-slug", "crop-offset": String(maxOffset + 1) }),
        makeContext("test-sys"),
      ),
    ).rejects.toThrow("Maximum allowed offset");
  });

  it("R2 fallback: downloads from R2 when raw file not in cache clone", async () => {
    const { runNachweisScreenshotProcess } =
      await import("../nachweis/nachweis-screenshot-process.ts");
    const cachePath = join(workspaceRoot, "systems-cache", "test-sys");
    await writeEntitlements(cachePath, ["nachweis"]);
    await writeEvidenceSource(cachePath, "test-slug", {
      rawArtifact: {
        sha256: "abc123",
        mediaType: "image/png",
        originalFilename: "screenshot.png",
        width: 3708,
        height: 27210,
        r2Key: "test-sys/screenshots/test-slug/raw/screenshot.png",
      },
    });
    // Do NOT write local raw file — force R2 fallback
    mockR2State.objects.set(
      "test-sys/screenshots/test-slug/raw/screenshot.png",
      new Uint8Array(Buffer.from("fake-raw-from-r2")),
    );

    const result = await runNachweisScreenshotProcess(
      makeInput({ system: "test-sys", slug: "test-slug" }),
      makeContext("test-sys"),
    );

    expect(result.exitCode).toBe(0);
    expect(mockR2State.getCalls).toBe(1);
    expect(mockR2State.putCalls).toBe(1);
  });

  it("capturedAt is null when rawArtifact.capturedAt is unset", async () => {
    const { runNachweisScreenshotProcess } =
      await import("../nachweis/nachweis-screenshot-process.ts");
    const cachePath = join(workspaceRoot, "systems-cache", "test-sys");
    await writeEntitlements(cachePath, ["nachweis"]);
    await writeEvidenceSource(cachePath, "test-slug", {
      rawArtifact: {
        sha256: "abc123",
        mediaType: "image/png",
        originalFilename: "screenshot.png",
        width: 3708,
        height: 27210,
        r2Key: "test-sys/screenshots/test-slug/raw/screenshot.png",
        localPath: join(
          cachePath,
          "trust",
          "evidence",
          "screenshots",
          "test-slug",
          "raw",
          "screenshot.png",
        ),
      },
    });
    await writeRawScreenshotFile(cachePath, "test-slug", "screenshot.png", Buffer.from("fake-raw"));

    const result = await runNachweisScreenshotProcess(
      makeInput({ system: "test-sys", slug: "test-slug", "dry-run": true }),
      makeContext("test-sys"),
    );
    const data = expectData(result);

    expect(data.capturedAt).toBeNull();
  });
});

describe("RFC-0891: resolveNachweisScreenshotDisplayR2Path", () => {
  it("builds R2 path with .webp extension", async () => {
    const { resolveNachweisScreenshotDisplayR2Path } = await import("../nachweis/nachweis-io.ts");
    const result = resolveNachweisScreenshotDisplayR2Path("warpgogol-com", "client-xyz");
    expect(result).toBe("warpgogol-com/screenshots/client-xyz/website-screenshot.webp");
  });
});
