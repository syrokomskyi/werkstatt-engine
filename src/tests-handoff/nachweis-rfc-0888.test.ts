/*
<MODULE_CONTRACT>
  <purpose>
    Unit tests for RFC-0888: sichtpass Bordbuch event kind for Sichtpass lifecycle audit trail.
  </purpose>
  <keywords>RFC-0888, sichtpass, bordbuch, nachweis, manifest, publish, withdraw, unit-test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0888: initial tests for sichtpass Bordbuch entry append in manifest.generate, publish, and withdraw.</item>
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

// ── Mock state ──────────────────────────────────────────────────────────────

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
    putObject: vi.fn(async () => {}),
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

// Mock readBordbuch to read from the same path where the mock appendAndCommitBordbuch writes.
// Without this, the real readBordbuch uses resolveCacheClonePath internally (which resolves to
// ../systems-cache/) and can't see entries written by the mock.
vi.mock("../bordbuch/bordbuch-io.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../bordbuch/bordbuch-io.ts")>();
  return {
    ...actual,
    readBordbuch: vi.fn(async (workspaceRoot: string, systemId: string) => {
      const { existsSync, readFileSync } = await import("node:fs");
      const filePath = join(workspaceRoot, "systems-cache", systemId, "bordbuch", "events.ndjson");
      if (!existsSync(filePath)) return [];
      const raw = readFileSync(filePath, "utf8");
      const lines = raw.split("\n").filter((l) => l.trim().length > 0);
      const entries: Array<Record<string, unknown>> = [];
      for (const line of lines) {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        entries.push(parsed);
      }
      return entries as never;
    }),
  };
});

// Track executeKernelCommand calls so we can verify --skip-bordbuch was passed
let manifestGenerateCalls: { argv: string[] }[] = [];

vi.mock("@warpgogol/werkstatt-engine/kernel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@warpgogol/werkstatt-engine/kernel")>();
  return {
    ...actual,
    executeKernelCommand: vi.fn(async (params: { commandName: string; argv?: string[] }) => {
      if (params.commandName === "nachweis.manifest.generate") {
        manifestGenerateCalls.push({ argv: params.argv ?? [] });
      }
      return {
        commandName: params.commandName,
        exitCode: 0,
        data: {},
        summary: `${params.commandName}: ok`,
      };
    }),
  };
});

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
    appendBatchAndCommitBordbuch: vi.fn(
      async (
        workspaceRoot: string,
        systemId: string,
        entries: Array<{
          kind: string;
          summary: string;
          actor: string;
          options?: Record<string, unknown>;
        }>,
        _commitMessage: string,
      ) => {
        const results: Array<{ id: string; kind: string; summary: string }> = [];
        for (const spec of entries) {
          const filePath = join(
            workspaceRoot,
            "systems-cache",
            systemId,
            "bordbuch",
            "events.ndjson",
          );
          const dir = join(workspaceRoot, "systems-cache", systemId, "bordbuch");
          if (!existsSync(dir)) await mkdir(dir, { recursive: true });
          const existingContent = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
          const prevLines = existingContent
            .trim()
            .split("\n")
            .filter((l: string) => l.trim());
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
            kind: spec.kind,
            status: spec.options?.status ?? "done",
            missionId: null,
            releaseId: null,
            actor: spec.actor,
            summary: spec.summary,
            metadata: spec.options?.metadata,
            previousHash,
            erratumOf: undefined,
          };
          const stable = JSON.stringify(entryWithoutHash, Object.keys(entryWithoutHash).sort());
          const { createHash } = await import("node:crypto");
          const hash = `sha256:${createHash("sha256").update(stable).digest("hex")}`;
          const entry = { ...entryWithoutHash, hash };
          const separator =
            existingContent.length > 0 && !existingContent.endsWith("\n") ? "\n" : "";
          await writeFile(
            filePath,
            `${existingContent}${separator}${JSON.stringify(entry)}\n`,
            "utf8",
          );
          results.push({ id: entry.id, kind: entry.kind, summary: entry.summary });
        }
        return {
          entries: results,
          commitResult: { commitSha: null, pushed: false, error: null },
        };
      },
    ),
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

async function writeSystemManifest(cachePath: string, langs: string[] = ["de"]): Promise<void> {
  const contentDir = join(cachePath, "src", "content");
  await mkdir(contentDir, { recursive: true });
  const supported = langs.map((l) => `    ${l}: true`).join("\n");
  await writeFile(
    join(contentDir, "system.md"),
    `---\ni18n:\n  default: de\n  supported:\n${supported}\n---\n`,
  );
}

async function writeEntitlements(
  cachePath: string,
  features: string[],
  langs: string[] = ["de"],
): Promise<void> {
  const dir = join(cachePath, "src");
  await mkdir(dir, { recursive: true });
  const { stringify: yamlStringify } = await import("yaml");
  await writeFile(join(dir, "entitlements.generated.yaml"), yamlStringify({ features }));
  await writeSystemManifest(cachePath, langs);
}

const PBP_ENTITY_DIR_MAP: Record<string, string> = {
  "evidence-source": "trust/evidence",
  consent: "trust/consents",
  claim: "trust/claims",
};

async function writePbpEntity(
  cachePath: string,
  lang: string,
  entityType: string,
  slug: string,
  data: Record<string, unknown>,
): Promise<void> {
  const subDir = PBP_ENTITY_DIR_MAP[entityType] ?? entityType;
  const dir = join(cachePath, "src", "content", "business-profile", lang, subDir);
  await mkdir(dir, { recursive: true });
  const frontmatter = Object.entries(data)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join("\n");
  await writeFile(join(dir, `${slug}.md`), `---\n${frontmatter}\n---\n\nContent\n`);
}

async function readBordbuchEntries(cachePath: string): Promise<Array<Record<string, unknown>>> {
  const filePath = join(cachePath, "bordbuch", "events.ndjson");
  if (!existsSync(filePath)) return [];
  const content = await readFile(filePath, "utf8");
  return content
    .trim()
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

async function writeBordbuchEntry(
  cachePath: string,
  entry: Record<string, unknown>,
): Promise<void> {
  const dir = join(cachePath, "bordbuch");
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, "events.ndjson");
  const existing = existsSync(filePath) ? await readFile(filePath, "utf8") : "";
  const separator = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  await writeFile(filePath, `${existing}${separator}${JSON.stringify(entry)}\n`);
}

const SHA256_A = "a".repeat(64);

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "tmp-nachweis-rfc-0888-"));
  workspaceRoot = tmpDir;
  manifestGenerateCalls = [];
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ── Tests: schema and writer-role ───────────────────────────────────────────

describe("RFC-0888: bordbuchEntryKindSchema includes sichtpass", () => {
  it("includes sichtpass in the enum", async () => {
    const { bordbuchEntryKindSchema } = await import("../schemas/mission.ts");
    expect(bordbuchEntryKindSchema.options).toContain("sichtpass");
  });
});

describe("RFC-0888: WRITER_ROLE_KINDS.nachweis includes sichtpass", () => {
  it("includes sichtpass in WRITER_ROLE_KINDS.nachweis", async () => {
    const { validateWriterRole } = await import("../bordbuch/bordbuch-io.ts");
    expect(validateWriterRole("nachweis", "sichtpass")).toBe(true);
  });

  it("rejects sichtpass for non-nachweis writer roles", async () => {
    const { validateWriterRole } = await import("../bordbuch/bordbuch-io.ts");
    expect(validateWriterRole("mission", "sichtpass")).toBe(false);
  });
});

// ── Tests: nachweis.manifest.generate sichtpass append ──────────────────────

describe("RFC-0888: nachweis.manifest.generate appends sichtpass", () => {
  beforeEach(async () => {
    const cachePath = join(workspaceRoot, "systems-cache", "test-system");
    await writeEntitlements(cachePath, ["nachweis"]);
  });

  it("appends sichtpass entry when --skip-bordbuch is not set", async () => {
    const { runNachweisManifestGenerate } = await import("../nachweis/nachweis-manifest.ts");
    await runNachweisManifestGenerate(makeInput({ system: "test-system" }), makeContext());

    const cachePath = join(workspaceRoot, "systems-cache", "test-system");
    const entries = await readBordbuchEntries(cachePath);
    const sichtpassEntries = entries.filter((e) => e.kind === "sichtpass");
    expect(sichtpassEntries).toHaveLength(1);
    expect(sichtpassEntries[0].metadata).toMatchObject({
      slug: "__manifest__",
      signaturePresent: false,
      timestampPresent: false,
      verificationLevel: "N0",
    });
  });

  it("does NOT append sichtpass entry when --skip-bordbuch is true", async () => {
    const { runNachweisManifestGenerate } = await import("../nachweis/nachweis-manifest.ts");
    await runNachweisManifestGenerate(
      makeInput({ system: "test-system", "skip-bordbuch": true }),
      makeContext(),
    );

    const cachePath = join(workspaceRoot, "systems-cache", "test-system");
    const entries = await readBordbuchEntries(cachePath);
    const sichtpassEntries = entries.filter((e) => e.kind === "sichtpass");
    expect(sichtpassEntries).toHaveLength(0);
  });

  it("appends sichtpass with recordHash even when no published records exist", async () => {
    const { runNachweisManifestGenerate } = await import("../nachweis/nachweis-manifest.ts");
    await runNachweisManifestGenerate(makeInput({ system: "test-system" }), makeContext());

    const cachePath = join(workspaceRoot, "systems-cache", "test-system");
    const entries = await readBordbuchEntries(cachePath);
    const sichtpassEntries = entries.filter((e) => e.kind === "sichtpass");
    expect(sichtpassEntries).toHaveLength(1);
    const meta = sichtpassEntries[0].metadata as Record<string, unknown> | undefined;
    expect(meta).toHaveProperty("recordHash");
    expect(typeof meta?.recordHash).toBe("string");
  });
});

// ── Tests: nachweis.publish sichtpass append ────────────────────────────────

describe("RFC-0888: nachweis.publish appends sichtpass", () => {
  beforeEach(async () => {
    const cachePath = join(workspaceRoot, "systems-cache", "test-system");
    await writeEntitlements(cachePath, ["nachweis"]);
    await writePbpEntity(cachePath, "de", "evidence-source", "test-ev", {
      slug: "test-ev",
      kind: "client-statement",
      recordStatus: "ready",
      items: { doc: { sha256: SHA256_A, storage: "public" } },
      display: { document: "visible", screenshot: "hidden", websiteLink: "hidden" },
      publication: { visibility: "private" },
    });
    await writePbpEntity(cachePath, "de", "consent", "test-ev", {
      slug: "test-ev",
      consentScope: {
        document: { status: "granted", grantedAt: "2026-01-01T00:00:00Z", method: "signed_pdf" },
        screenshot: { status: "not_requested", grantedAt: null, method: "none" },
        websiteLink: { status: "not_requested", grantedAt: null, method: "none" },
      },
    });
    // Write bordbuch entries to satisfy gate conditions
    await writeBordbuchEntry(cachePath, {
      schemaVersion: "1.0.0",
      id: "event-000001",
      systemId: "test-system",
      occurredAt: "2026-01-01T00:00:00Z",
      kind: "nachweis-record",
      status: "done",
      missionId: null,
      releaseId: null,
      actor: "agent",
      summary: "Record approved for test-ev",
      metadata: { slug: "test-ev", verificationLevel: "N3", legalContentCheckPassed: true },
      previousHash: null,
      hash: "sha256:fake-hash-1",
    });
  });

  it("appends exactly one sichtpass entry and passes --skip-bordbuch to manifest.generate", async () => {
    const { runNachweisPublish } = await import("../nachweis/nachweis-publish.ts");
    await runNachweisPublish(makeInput({ system: "test-system", slug: "test-ev" }), makeContext());

    const cachePath = join(workspaceRoot, "systems-cache", "test-system");
    const entries = await readBordbuchEntries(cachePath);
    const sichtpassEntries = entries.filter((e) => e.kind === "sichtpass");
    expect(sichtpassEntries).toHaveLength(1);
    expect(sichtpassEntries[0].metadata).toMatchObject({
      slug: "test-ev",
      verificationLevel: "N3",
    });

    // Verify manifest.generate was called with --skip-bordbuch
    expect(manifestGenerateCalls).toHaveLength(1);
    expect(manifestGenerateCalls[0].argv).toContain("--skip-bordbuch");
  });
});

// ── Tests: nachweis.withdraw sichtpass append ───────────────────────────────

describe("RFC-0888: nachweis.withdraw appends sichtpass with withdrawn: true", () => {
  beforeEach(async () => {
    const cachePath = join(workspaceRoot, "systems-cache", "test-system");
    await writeEntitlements(cachePath, ["nachweis"]);
    await writePbpEntity(cachePath, "de", "evidence-source", "test-ev", {
      slug: "test-ev",
      kind: "client-statement",
      recordStatus: "published",
      items: { doc: { sha256: SHA256_A } },
      publication: { visibility: "public", publishedAt: "2026-01-01T00:00:00Z" },
    });
  });

  it("appends exactly one sichtpass entry with withdrawn: true and passes --skip-bordbuch", async () => {
    const { runNachweisWithdraw } = await import("../nachweis/nachweis-withdraw.ts");
    await runNachweisWithdraw(makeInput({ system: "test-system", slug: "test-ev" }), makeContext());

    const cachePath = join(workspaceRoot, "systems-cache", "test-system");
    const entries = await readBordbuchEntries(cachePath);
    const sichtpassEntries = entries.filter((e) => e.kind === "sichtpass");
    expect(sichtpassEntries).toHaveLength(1);
    expect(sichtpassEntries[0].metadata).toMatchObject({
      slug: "test-ev",
      withdrawn: true,
    });

    // Verify manifest.generate was called with --skip-bordbuch
    expect(manifestGenerateCalls).toHaveLength(1);
    expect(manifestGenerateCalls[0].argv).toContain("--skip-bordbuch");
  });
});
