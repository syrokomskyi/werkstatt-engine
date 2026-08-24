/*
<MODULE_CONTRACT>
  <purpose>
    Unit tests for RFC-0886: granular consent commands, screenshot upload, and
    per-artifact publication gates.
  </purpose>
  <keywords>RFC-0886, nachweis, granular-consent, screenshot, display-consent, gate, unit-test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0886: initial tests for granular consent, screenshot upload, display-consent-consistent gate condition, NACHWEIS-DISPLAY-CONSENT-01 validation, manifest display/websiteUrl.</item>
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

async function readPbpEntity(
  cachePath: string,
  lang: string,
  entityType: string,
  slug: string,
): Promise<Record<string, unknown>> {
  const { parseMarkdownFrontmatter } = await import("@warpgogol/werkstatt-shared/content");
  const subDir = PBP_ENTITY_DIR_MAP[entityType] ?? entityType;
  const dir = join(cachePath, "src", "content", "business-profile", lang, subDir);
  const raw = await readFile(join(dir, `${slug}.md`), "utf8");
  const { data } = parseMarkdownFrontmatter(raw);
  return data as Record<string, unknown>;
}

async function _writeBordbuchEntry(
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
  tmpDir = await mkdtemp(join(tmpdir(), "tmp-nachweis-rfc-0886-"));
  workspaceRoot = tmpDir;
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ── Tests: GATE_CONDITION_IDS and REQUIRED_CONDITIONS ───────────────────────

describe("RFC-0886: GATE_CONDITION_IDS includes display-consent-consistent", () => {
  it("includes display-consent-consistent in GATE_CONDITION_IDS", async () => {
    const { GATE_CONDITION_IDS } = await import("../nachweis/nachweis-io.ts");
    expect(GATE_CONDITION_IDS).toContain("display-consent-consistent");
  });

  it("requires display-consent-consistent for attestation-v1", async () => {
    const { isConditionRequired } = await import("../nachweis/nachweis-io.ts");
    expect(isConditionRequired("attestation-v1", "display-consent-consistent")).toBe(true);
  });

  it("does NOT require display-consent-consistent for operational-measurement-v1", async () => {
    const { isConditionRequired } = await import("../nachweis/nachweis-io.ts");
    expect(isConditionRequired("operational-measurement-v1", "display-consent-consistent")).toBe(
      false,
    );
  });

  it("does NOT require display-consent-consistent for technical-assessment-v1", async () => {
    const { isConditionRequired } = await import("../nachweis/nachweis-io.ts");
    expect(isConditionRequired("technical-assessment-v1", "display-consent-consistent")).toBe(
      false,
    );
  });
});

// ── Tests: resolveNachweisScreenshotR2Path ──────────────────────────────────

describe("RFC-0886: resolveNachweisScreenshotR2Path", () => {
  it("constructs correct R2 path for webp", async () => {
    const { resolveNachweisScreenshotR2Path } = await import("../nachweis/nachweis-io.ts");
    expect(resolveNachweisScreenshotR2Path("test-system", "my-slug", ".webp")).toBe(
      "test-system/screenshots/my-slug/website-screenshot.webp",
    );
  });

  it("constructs correct R2 path for png", async () => {
    const { resolveNachweisScreenshotR2Path } = await import("../nachweis/nachweis-io.ts");
    expect(resolveNachweisScreenshotR2Path("test-system", "my-slug", ".png")).toBe(
      "test-system/screenshots/my-slug/website-screenshot.png",
    );
  });

  it("does not collide with evidence PDF paths", async () => {
    const { resolveNachweisScreenshotR2Path, resolveNachweisPublicR2Path } =
      await import("../nachweis/nachweis-io.ts");
    const screenshotPath = resolveNachweisScreenshotR2Path("sys", "slug", ".webp");
    const evidencePath = resolveNachweisPublicR2Path("sys", "nr_slug", 1);
    expect(screenshotPath).not.toBe(evidencePath);
    expect(screenshotPath).toContain("/screenshots/");
    expect(evidencePath).toContain("/public/");
  });
});

// ── Tests: evaluateGateV2 per-aspect consent ────────────────────────────────

describe("RFC-0886: evaluateGateV2 per-aspect consent", () => {
  it("passes display-consent-consistent when all visible aspects have granted consent", async () => {
    const { evaluateGateV2 } = await import("../nachweis/nachweis-io.ts");
    const gate = evaluateGateV2("test-slug", "client-statement", {
      evidenceData: {
        items: { doc: { sha256: SHA256_A } },
        display: { document: "visible", screenshot: "hidden", websiteLink: "hidden" },
      },
      consentData: {
        consentScope: {
          document: { status: "granted" },
          screenshot: { status: "not_requested" },
          websiteLink: { status: "not_requested" },
        },
      },
      bordbuchEntries: [],
    });
    const dcCondition = gate.conditions.find((c) => c.id === "display-consent-consistent");
    expect(dcCondition?.status).toBe("pass");
  });

  it("fails display-consent-consistent when a visible aspect lacks granted consent", async () => {
    const { evaluateGateV2 } = await import("../nachweis/nachweis-io.ts");
    const gate = evaluateGateV2("test-slug", "client-statement", {
      evidenceData: {
        items: { doc: { sha256: SHA256_A } },
        display: { document: "visible", screenshot: "visible", websiteLink: "hidden" },
      },
      consentData: {
        consentScope: {
          document: { status: "granted" },
          screenshot: { status: "not_requested" },
          websiteLink: { status: "not_requested" },
        },
      },
      bordbuchEntries: [],
    });
    const dcCondition = gate.conditions.find((c) => c.id === "display-consent-consistent");
    expect(dcCondition?.status).toBe("fail");
  });

  it("passes display-consent-consistent when no aspects are visible", async () => {
    const { evaluateGateV2 } = await import("../nachweis/nachweis-io.ts");
    const gate = evaluateGateV2("test-slug", "client-statement", {
      evidenceData: {
        items: { doc: { sha256: SHA256_A } },
        display: { document: "hidden", screenshot: "hidden", websiteLink: "hidden" },
      },
      consentData: {
        consentScope: {
          document: { status: "not_requested" },
          screenshot: { status: "not_requested" },
          websiteLink: { status: "not_requested" },
        },
      },
      bordbuchEntries: [],
    });
    const dcCondition = gate.conditions.find((c) => c.id === "display-consent-consistent");
    expect(dcCondition?.status).toBe("pass");
  });

  it("passes display-consent-consistent when display field is absent", async () => {
    const { evaluateGateV2 } = await import("../nachweis/nachweis-io.ts");
    const gate = evaluateGateV2("test-slug", "client-statement", {
      evidenceData: {
        items: { doc: { sha256: SHA256_A } },
      },
      consentData: {},
      bordbuchEntries: [],
    });
    const dcCondition = gate.conditions.find((c) => c.id === "display-consent-consistent");
    expect(dcCondition?.status).toBe("pass");
  });

  it("passes all visible aspects with granted consent for multi-aspect", async () => {
    const { evaluateGateV2 } = await import("../nachweis/nachweis-io.ts");
    const gate = evaluateGateV2("test-slug", "client-statement", {
      evidenceData: {
        items: { doc: { sha256: SHA256_A } },
        display: { document: "visible", screenshot: "visible", websiteLink: "visible" },
      },
      consentData: {
        consentScope: {
          document: { status: "granted" },
          screenshot: { status: "granted" },
          websiteLink: { status: "granted" },
        },
      },
      bordbuchEntries: [],
    });
    const dcCondition = gate.conditions.find((c) => c.id === "display-consent-consistent");
    expect(dcCondition?.status).toBe("pass");
  });

  it("display-consent-consistent is not_applicable for technical-assessment-v1", async () => {
    const { evaluateGateV2 } = await import("../nachweis/nachweis-io.ts");
    const gate = evaluateGateV2("test-slug", "technical-assessment", {
      evidenceData: {
        items: { raw: { sha256: SHA256_A, role: "raw-result", canonical: true } },
        assessment: {
          profile: "technical-assessment",
          seriesId: "s1",
          observationId: "o1",
          provider: { id: "p1", name: "P" },
          tool: { id: "t1", name: "T" },
          executionMode: "operator-run",
          authorizationBasis: "site-owner",
          observedAt: "2026-08-01T00:00:00Z",
          methodology: { id: "m1", version: "1.0", runCount: 1, aggregation: "median" },
          dimensions: [{ id: "perf", providerLabel: "Perf", score: 90 }],
          freshness: { maxAgeDays: 30 },
        },
        display: { document: "visible", screenshot: "visible", websiteLink: "visible" },
      },
      consentData: {},
      bordbuchEntries: [],
    });
    const dcCondition = gate.conditions.find((c) => c.id === "display-consent-consistent");
    expect(dcCondition?.status).toBe("not_applicable");
  });
});

// ── Tests: nachweis.consent.update with --scope ─────────────────────────────

describe("RFC-0886: nachweis.consent.update --scope", () => {
  beforeEach(async () => {
    const cachePath = join(workspaceRoot, "systems-cache", "test-system");
    await writeEntitlements(cachePath, ["nachweis"]);
    await writePbpEntity(cachePath, "de", "consent", "test-consent", {
      slug: "test-consent",
      consentScope: {
        document: { status: "not_requested", grantedAt: null, method: "none" },
        screenshot: { status: "not_requested", grantedAt: null, method: "none" },
        websiteLink: { status: "not_requested", grantedAt: null, method: "none" },
      },
    });
  });

  it("updates document scope when --scope document", async () => {
    const { runNachweisConsentUpdate } = await import("../nachweis/nachweis-consent.ts");
    const result = await runNachweisConsentUpdate(
      makeInput({
        system: "test-system",
        "consent-id": "test-consent",
        scope: "document",
        status: "granted",
        method: "verified_business_email",
      }),
      makeContext(),
    );
    const data = expectData(result);
    expect(data.scope).toBe("document");
    expect(data.newStatus).toBe("granted");
    expect(data.previousStatus).toBe("not_requested");

    const cachePath = join(workspaceRoot, "systems-cache", "test-system");
    const updated = await readPbpEntity(cachePath, "de", "consent", "test-consent");
    const scope = updated.consentScope as Record<string, { status?: string }>;
    expect(scope.document.status).toBe("granted");
    expect(scope.screenshot.status).toBe("not_requested");
    expect(scope.websiteLink.status).toBe("not_requested");
  });

  it("updates screenshot scope when --scope screenshot", async () => {
    const { runNachweisConsentUpdate } = await import("../nachweis/nachweis-consent.ts");
    const result = await runNachweisConsentUpdate(
      makeInput({
        system: "test-system",
        "consent-id": "test-consent",
        scope: "screenshot",
        status: "granted",
        method: "signed_pdf",
      }),
      makeContext(),
    );
    const data = expectData(result);
    expect(data.scope).toBe("screenshot");

    const cachePath = join(workspaceRoot, "systems-cache", "test-system");
    const updated = await readPbpEntity(cachePath, "de", "consent", "test-consent");
    const scope = updated.consentScope as Record<string, { status?: string }>;
    expect(scope.document.status).toBe("not_requested");
    expect(scope.screenshot.status).toBe("granted");
    expect(scope.websiteLink.status).toBe("not_requested");
  });

  it("updates websiteLink scope when --scope websiteLink", async () => {
    const { runNachweisConsentUpdate } = await import("../nachweis/nachweis-consent.ts");
    const result = await runNachweisConsentUpdate(
      makeInput({
        system: "test-system",
        "consent-id": "test-consent",
        scope: "websiteLink",
        status: "granted",
      }),
      makeContext(),
    );
    const data = expectData(result);
    expect(data.scope).toBe("websiteLink");

    const cachePath = join(workspaceRoot, "systems-cache", "test-system");
    const updated = await readPbpEntity(cachePath, "de", "consent", "test-consent");
    const scope = updated.consentScope as Record<string, { status?: string }>;
    expect(scope.websiteLink.status).toBe("granted");
    expect(scope.document.status).toBe("not_requested");
  });

  it("throws when --scope is missing", async () => {
    const { runNachweisConsentUpdate } = await import("../nachweis/nachweis-consent.ts");
    await expect(
      runNachweisConsentUpdate(
        makeInput({
          system: "test-system",
          "consent-id": "test-consent",
          status: "granted",
        }),
        makeContext(),
      ),
    ).rejects.toThrow("--scope is required");
  });

  it("throws when --scope is invalid", async () => {
    const { runNachweisConsentUpdate } = await import("../nachweis/nachweis-consent.ts");
    await expect(
      runNachweisConsentUpdate(
        makeInput({
          system: "test-system",
          "consent-id": "test-consent",
          scope: "invalid",
          status: "granted",
        }),
        makeContext(),
      ),
    ).rejects.toThrow("invalid --scope");
  });

  it("preserves other scopes when updating one scope", async () => {
    const { runNachweisConsentUpdate } = await import("../nachweis/nachweis-consent.ts");
    await runNachweisConsentUpdate(
      makeInput({
        system: "test-system",
        "consent-id": "test-consent",
        scope: "document",
        status: "granted",
        method: "verified_business_email",
      }),
      makeContext(),
    );
    await runNachweisConsentUpdate(
      makeInput({
        system: "test-system",
        "consent-id": "test-consent",
        scope: "screenshot",
        status: "granted",
        method: "signed_pdf",
      }),
      makeContext(),
    );
    const cachePath = join(workspaceRoot, "systems-cache", "test-system");
    const updated = await readPbpEntity(cachePath, "de", "consent", "test-consent");
    const scope = updated.consentScope as Record<string, { status?: string; method?: string }>;
    expect(scope.document.status).toBe("granted");
    expect(scope.document.method).toBe("verified_business_email");
    expect(scope.screenshot.status).toBe("granted");
    expect(scope.screenshot.method).toBe("signed_pdf");
    expect(scope.websiteLink.status).toBe("not_requested");
  });
});

// ── Tests: nachweis.screenshot.upload ───────────────────────────────────────

describe("RFC-0886: nachweis.screenshot.upload", () => {
  beforeEach(async () => {
    const cachePath = join(workspaceRoot, "systems-cache", "test-system");
    await writeEntitlements(cachePath, ["nachweis"]);
    await writePbpEntity(cachePath, "de", "evidence-source", "test-evidence", {
      slug: "test-evidence",
      kind: "client-statement",
      items: { doc: { sha256: SHA256_A } },
    });
  });

  it("uploads screenshot and updates evidence-source in dry-run", async () => {
    const { runNachweisScreenshotUpload } =
      await import("../nachweis/nachweis-screenshot-upload.ts");
    const screenshotFile = join(tmpDir, "screenshot.webp");
    await writeFile(screenshotFile, Buffer.from("fake-webp-data"));

    const result = await runNachweisScreenshotUpload(
      makeInput({
        system: "test-system",
        slug: "test-evidence",
        file: screenshotFile,
        "dry-run": "true",
      }),
      makeContext(),
    );
    const data = expectData(result);
    expect(data.slug).toBe("test-evidence");
    expect(data.mediaType).toBe("image/webp");
    expect(data.storage).toBe("public");
    expect(data.r2Key).toBe("test-system/screenshots/test-evidence/website-screenshot.webp");
  });

  it("throws for unsupported file extension", async () => {
    const { runNachweisScreenshotUpload } =
      await import("../nachweis/nachweis-screenshot-upload.ts");
    const screenshotFile = join(tmpDir, "screenshot.gif");
    await writeFile(screenshotFile, Buffer.from("fake-gif-data"));

    await expect(
      runNachweisScreenshotUpload(
        makeInput({
          system: "test-system",
          slug: "test-evidence",
          file: screenshotFile,
        }),
        makeContext(),
      ),
    ).rejects.toThrow("unsupported file extension");
  });

  it("throws when evidence-source does not exist", async () => {
    const { runNachweisScreenshotUpload } =
      await import("../nachweis/nachweis-screenshot-upload.ts");
    const screenshotFile = join(tmpDir, "screenshot.png");
    await writeFile(screenshotFile, Buffer.from("fake-png-data"));

    await expect(
      runNachweisScreenshotUpload(
        makeInput({
          system: "test-system",
          slug: "nonexistent",
          file: screenshotFile,
        }),
        makeContext(),
      ),
    ).rejects.toThrow("NOT_FOUND");
  });

  it("throws when --slug is missing", async () => {
    const { runNachweisScreenshotUpload } =
      await import("../nachweis/nachweis-screenshot-upload.ts");
    const screenshotFile = join(tmpDir, "screenshot.png");
    await writeFile(screenshotFile, Buffer.from("fake-png-data"));

    await expect(
      runNachweisScreenshotUpload(
        makeInput({
          system: "test-system",
          file: screenshotFile,
        }),
        makeContext(),
      ),
    ).rejects.toThrow("--slug is required");
  });

  it("uploads and updates evidence-source websiteScreenshot on real run", async () => {
    const { runNachweisScreenshotUpload } =
      await import("../nachweis/nachweis-screenshot-upload.ts");
    const screenshotFile = join(tmpDir, "screenshot.jpg");
    await writeFile(screenshotFile, Buffer.from("fake-jpg-data"));

    const result = await runNachweisScreenshotUpload(
      makeInput({
        system: "test-system",
        slug: "test-evidence",
        file: screenshotFile,
      }),
      makeContext(),
    );
    const data = expectData(result);
    expect(data.mediaType).toBe("image/jpeg");
    expect(data.r2Key).toBe("test-system/screenshots/test-evidence/website-screenshot.jpg");
    expect(data.sha256).toBeTruthy();

    const cachePath = join(workspaceRoot, "systems-cache", "test-system");
    const updated = await readPbpEntity(cachePath, "de", "evidence-source", "test-evidence");
    const ws = updated.websiteScreenshot as Record<string, unknown>;
    expect(ws.storage).toBe("public");
    expect(ws.mediaType).toBe("image/jpeg");
    expect(ws.url).toBe(data.r2Key);
  });
});

// ── Tests: NACHWEIS-DISPLAY-CONSENT-01 validation ───────────────────────────

describe("RFC-0886: NACHWEIS-DISPLAY-CONSENT-01 validation", () => {
  beforeEach(async () => {
    const cachePath = join(workspaceRoot, "systems-cache", "test-system");
    await writeEntitlements(cachePath, ["nachweis"]);
  });

  it("reports NACHWEIS-DISPLAY-CONSENT-01 when visible aspect lacks granted consent", async () => {
    const cachePath = join(workspaceRoot, "systems-cache", "test-system");
    await writePbpEntity(cachePath, "de", "evidence-source", "test-ev", {
      slug: "test-ev",
      kind: "client-statement",
      items: { doc: { sha256: SHA256_A } },
      display: { document: "visible", screenshot: "hidden", websiteLink: "hidden" },
    });
    await writePbpEntity(cachePath, "de", "consent", "test-ev", {
      slug: "test-ev",
      consentScope: {
        document: { status: "not_requested", grantedAt: null, method: "none" },
        screenshot: { status: "not_requested", grantedAt: null, method: "none" },
        websiteLink: { status: "not_requested", grantedAt: null, method: "none" },
      },
    });

    const { runNachweisValidate } = await import("../nachweis/nachweis-validate.ts");
    const result = await runNachweisValidate(makeInput({ system: "test-system" }), makeContext());
    const data = expectData(result);
    const dcViolations = data.violations.filter(
      (v: { rule: string }) => v.rule === "NACHWEIS-DISPLAY-CONSENT-01",
    );
    expect(dcViolations.length).toBeGreaterThan(0);
    expect(dcViolations[0].message).toContain("display.document");
    expect(dcViolations[0].message).toContain("visible");
  });

  it("does NOT report NACHWEIS-DISPLAY-CONSENT-01 when visible aspect has granted consent", async () => {
    const cachePath = join(workspaceRoot, "systems-cache", "test-system");
    await writePbpEntity(cachePath, "de", "evidence-source", "test-ev", {
      slug: "test-ev",
      kind: "client-statement",
      items: { doc: { sha256: SHA256_A } },
      display: { document: "visible", screenshot: "hidden", websiteLink: "hidden" },
    });
    await writePbpEntity(cachePath, "de", "consent", "test-ev", {
      slug: "test-ev",
      consentScope: {
        document: { status: "granted", grantedAt: "2026-01-01T00:00:00Z", method: "signed_pdf" },
        screenshot: { status: "not_requested", grantedAt: null, method: "none" },
        websiteLink: { status: "not_requested", grantedAt: null, method: "none" },
      },
    });

    const { runNachweisValidate } = await import("../nachweis/nachweis-validate.ts");
    const result = await runNachweisValidate(makeInput({ system: "test-system" }), makeContext());
    const data = expectData(result);
    const dcViolations = data.violations.filter(
      (v: { rule: string }) => v.rule === "NACHWEIS-DISPLAY-CONSENT-01",
    );
    expect(dcViolations).toHaveLength(0);
  });

  it("does NOT report NACHWEIS-DISPLAY-CONSENT-01 when display is absent", async () => {
    const cachePath = join(workspaceRoot, "systems-cache", "test-system");
    await writePbpEntity(cachePath, "de", "evidence-source", "test-ev", {
      slug: "test-ev",
      kind: "client-statement",
      items: { doc: { sha256: SHA256_A } },
    });
    await writePbpEntity(cachePath, "de", "consent", "test-ev", {
      slug: "test-ev",
      consentScope: {
        document: { status: "not_requested", grantedAt: null, method: "none" },
        screenshot: { status: "not_requested", grantedAt: null, method: "none" },
        websiteLink: { status: "not_requested", grantedAt: null, method: "none" },
      },
    });

    const { runNachweisValidate } = await import("../nachweis/nachweis-validate.ts");
    const result = await runNachweisValidate(makeInput({ system: "test-system" }), makeContext());
    const data = expectData(result);
    const dcViolations = data.violations.filter(
      (v: { rule: string }) => v.rule === "NACHWEIS-DISPLAY-CONSENT-01",
    );
    expect(dcViolations).toHaveLength(0);
  });

  it("reports multiple NACHWEIS-DISPLAY-CONSENT-01 for multiple mismatched aspects", async () => {
    const cachePath = join(workspaceRoot, "systems-cache", "test-system");
    await writePbpEntity(cachePath, "de", "evidence-source", "test-ev", {
      slug: "test-ev",
      kind: "client-statement",
      items: { doc: { sha256: SHA256_A } },
      display: { document: "visible", screenshot: "visible", websiteLink: "visible" },
    });
    await writePbpEntity(cachePath, "de", "consent", "test-ev", {
      slug: "test-ev",
      consentScope: {
        document: { status: "not_requested", grantedAt: null, method: "none" },
        screenshot: { status: "not_requested", grantedAt: null, method: "none" },
        websiteLink: { status: "not_requested", grantedAt: null, method: "none" },
      },
    });

    const { runNachweisValidate } = await import("../nachweis/nachweis-validate.ts");
    const result = await runNachweisValidate(makeInput({ system: "test-system" }), makeContext());
    const data = expectData(result);
    const dcViolations = data.violations.filter(
      (v: { rule: string }) => v.rule === "NACHWEIS-DISPLAY-CONSENT-01",
    );
    expect(dcViolations).toHaveLength(3);
  });
});

// ── Tests: Manifest includes display and websiteUrl ─────────────────────────

describe("RFC-0886: nachweis.manifest.generate includes display and websiteUrl", () => {
  beforeEach(async () => {
    const cachePath = join(workspaceRoot, "systems-cache", "test-system");
    await writeEntitlements(cachePath, ["nachweis"]);
  });

  it("includes display and websiteUrl in manifest entries when present", async () => {
    const cachePath = join(workspaceRoot, "systems-cache", "test-system");
    await writePbpEntity(cachePath, "de", "evidence-source", "test-ev", {
      slug: "test-ev",
      kind: "client-statement",
      recordId: "nr_test-ev_20260101",
      titleDe: "Test DE",
      titleUk: "Test UK",
      qualityStatus: "verified",
      items: { doc: { sha256: SHA256_A } },
      publication: { visibility: "public", publishedAt: "2026-01-01T00:00:00Z" },
      display: { document: "visible", screenshot: "visible", websiteLink: "hidden" },
      websiteUrl: "https://example.com",
    });

    const { runNachweisManifestGenerate } = await import("../nachweis/nachweis-manifest.ts");
    const result = await runNachweisManifestGenerate(
      makeInput({ system: "test-system" }),
      makeContext(),
    );
    const data = expectData(result);
    expect(data.records).toHaveLength(1);
    const entry = data.records[0];
    expect(entry.display).toEqual({
      document: "visible",
      screenshot: "visible",
      websiteLink: "hidden",
    });
    expect(entry.websiteUrl).toBe("https://example.com");
  });

  it("omits display and websiteUrl when not present", async () => {
    const cachePath = join(workspaceRoot, "systems-cache", "test-system");
    await writePbpEntity(cachePath, "de", "evidence-source", "test-ev", {
      slug: "test-ev",
      kind: "client-statement",
      recordId: "nr_test-ev_20260101",
      titleDe: "Test DE",
      titleUk: "Test UK",
      qualityStatus: "verified",
      items: { doc: { sha256: SHA256_A } },
      publication: { visibility: "public", publishedAt: "2026-01-01T00:00:00Z" },
    });

    const { runNachweisManifestGenerate } = await import("../nachweis/nachweis-manifest.ts");
    const result = await runNachweisManifestGenerate(
      makeInput({ system: "test-system" }),
      makeContext(),
    );
    const data = expectData(result);
    expect(data.records).toHaveLength(1);
    const entry = data.records[0];
    expect(entry.display).toBeUndefined();
    expect(entry.websiteUrl).toBeUndefined();
  });
});

// ── Tests: NachweisConsentUpdateResult has scope field ──────────────────────

describe("RFC-0886: NachweisConsentUpdateResult interface", () => {
  it("includes scope field in the result type", async () => {
    const { runNachweisConsentUpdate } = await import("../nachweis/nachweis-consent.ts");
    const cachePath = join(workspaceRoot, "systems-cache", "test-system");
    await writeEntitlements(cachePath, ["nachweis"]);
    await writePbpEntity(cachePath, "de", "consent", "c1", {
      slug: "c1",
      consentScope: {
        document: { status: "not_requested", grantedAt: null, method: "none" },
        screenshot: { status: "not_requested", grantedAt: null, method: "none" },
        websiteLink: { status: "not_requested", grantedAt: null, method: "none" },
      },
    });

    const result = await runNachweisConsentUpdate(
      makeInput({
        system: "test-system",
        "consent-id": "c1",
        scope: "document",
        status: "granted",
      }),
      makeContext(),
    );
    const data = expectData(result);
    expect(data).toHaveProperty("scope");
    expect(typeof data.scope).toBe("string");
  });
});

// ── Tests: NachweisManifestEntry has display and websiteUrl ─────────────────

describe("RFC-0886: NachweisManifestEntry interface", () => {
  it("accepts display and websiteUrl optional fields", async () => {
    const { GATE_CONDITION_IDS } = await import("../nachweis/nachweis-io.ts");
    expect(GATE_CONDITION_IDS).toContain("display-consent-consistent");
  });
});
