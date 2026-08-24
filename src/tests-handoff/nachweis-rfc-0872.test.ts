/*
<MODULE_CONTRACT>
  <purpose>
    Unit tests for RFC-0872: policy-driven publication gates V2, technical-assessment
    evidence kind, conditional consent revocation, manifest observation identity,
    and locale drift detection.
  </purpose>
  <keywords>RFC-0872, nachweis, technical-assessment, gate-v2, policy, locale-drift, unit-test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0872: initial tests for policy resolution, gate V2, technical-assessment validation, withdraw, manifest, locale drift.</item>
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
        const { existsSync, readFileSync } = await import("node:fs");
        const fsPromises = await import("node:fs/promises");
        const nodePath = await import("node:path");
        const { createHash } = await import("node:crypto");
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
        const results: Array<{ id: string; hash: string }> = [];
        let currentPrev = previousHash;
        let currentMax = maxNum;
        let content = existingContent;
        for (const e of entries) {
          const id = `event-${String(currentMax + 1).padStart(6, "0")}`;
          const entryWithoutHash = {
            schemaVersion: "1.0.0",
            id,
            systemId,
            occurredAt: new Date().toISOString(),
            kind: e.kind,
            status: (e.options as { status?: string })?.status ?? "done",
            missionId: null,
            releaseId: null,
            actor: e.actor,
            summary: e.summary,
            metadata: (e.options as { metadata?: unknown })?.metadata,
            previousHash: currentPrev,
            erratumOf: undefined,
          };
          const stable = JSON.stringify(entryWithoutHash, Object.keys(entryWithoutHash).sort());
          const hash = `sha256:${createHash("sha256").update(stable).digest("hex")}`;
          const entry = { ...entryWithoutHash, hash };
          const separator = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
          content = `${content}${separator}${JSON.stringify(entry)}\n`;
          results.push({ id, hash });
          currentPrev = hash;
          currentMax++;
        }
        await fsPromises.writeFile(filePath, content, "utf8");
        return {
          entries: results.map((r) => ({ id: r.id, hash: r.hash })),
          commitResult: { commitSha: null, pushed: false, error: null },
        };
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

function makeAssessment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    profile: "technical-assessment",
    seriesId: "series-001",
    observationId: "obs-001",
    subject: { url: "https://example.com" },
    provider: { id: "provider-1", name: "Test Provider" },
    tool: { id: "tool-1", name: "Test Tool" },
    executionMode: "operator-run",
    authorizationBasis: "site-owner",
    observedAt: "2026-08-01T00:00:00Z",
    methodology: {
      id: "method-1",
      version: "1.0",
      runCount: 3,
      aggregation: "median",
    },
    dimensions: [{ id: "perf", providerLabel: "Performance", score: 90 }],
    freshness: { maxAgeDays: 30 },
    ...overrides,
  };
}

// ── Tests: Policy resolution ───────────────────────────────────────────────

describe("RFC-0872: resolveNachweisPublicationPolicy", () => {
  it("maps client-statement to attestation-v1", async () => {
    const { resolveNachweisPublicationPolicy } = await import("../nachweis/nachweis-io.ts");
    expect(resolveNachweisPublicationPolicy("client-statement")).toBe("attestation-v1");
  });

  it("maps project-confirmation to attestation-v1", async () => {
    const { resolveNachweisPublicationPolicy } = await import("../nachweis/nachweis-io.ts");
    expect(resolveNachweisPublicationPolicy("project-confirmation")).toBe("attestation-v1");
  });

  it("maps certificate to attestation-v1", async () => {
    const { resolveNachweisPublicationPolicy } = await import("../nachweis/nachweis-io.ts");
    expect(resolveNachweisPublicationPolicy("certificate")).toBe("attestation-v1");
  });

  it("maps operational-evidence to operational-measurement-v1", async () => {
    const { resolveNachweisPublicationPolicy } = await import("../nachweis/nachweis-io.ts");
    expect(resolveNachweisPublicationPolicy("operational-evidence")).toBe(
      "operational-measurement-v1",
    );
  });

  it("maps technical-assessment to technical-assessment-v1", async () => {
    const { resolveNachweisPublicationPolicy } = await import("../nachweis/nachweis-io.ts");
    expect(resolveNachweisPublicationPolicy("technical-assessment")).toBe(
      "technical-assessment-v1",
    );
  });

  it("throws UnsupportedNachweisKindError for unknown kind", async () => {
    const { resolveNachweisPublicationPolicy, UnsupportedNachweisKindError } =
      await import("../nachweis/nachweis-io.ts");
    expect(() => resolveNachweisPublicationPolicy("unknown-kind")).toThrow(
      UnsupportedNachweisKindError,
    );
  });
});

// ── Tests: isConditionRequired ─────────────────────────────────────────────

describe("RFC-0872: isConditionRequired", () => {
  it("requires consent-granted for attestation-v1", async () => {
    const { isConditionRequired } = await import("../nachweis/nachweis-io.ts");
    expect(isConditionRequired("attestation-v1", "consent-granted")).toBe(true);
  });

  it("does NOT require consent-granted for technical-assessment-v1", async () => {
    const { isConditionRequired } = await import("../nachweis/nachweis-io.ts");
    expect(isConditionRequired("technical-assessment-v1", "consent-granted")).toBe(false);
  });

  it("does NOT require consent-granted for operational-measurement-v1", async () => {
    const { isConditionRequired } = await import("../nachweis/nachweis-io.ts");
    expect(isConditionRequired("operational-measurement-v1", "consent-granted")).toBe(false);
  });

  it("requires canonical-raw-artifact-verified for technical-assessment-v1", async () => {
    const { isConditionRequired } = await import("../nachweis/nachweis-io.ts");
    expect(isConditionRequired("technical-assessment-v1", "canonical-raw-artifact-verified")).toBe(
      true,
    );
  });

  it("requires assessment-metadata-valid for technical-assessment-v1", async () => {
    const { isConditionRequired } = await import("../nachweis/nachweis-io.ts");
    expect(isConditionRequired("technical-assessment-v1", "assessment-metadata-valid")).toBe(true);
  });

  it("requires execution-authorization-basis-present for operational-measurement-v1", async () => {
    const { isConditionRequired } = await import("../nachweis/nachweis-io.ts");
    expect(
      isConditionRequired("operational-measurement-v1", "execution-authorization-basis-present"),
    ).toBe(true);
  });

  it("does NOT require public-derivative-ready for technical-assessment-v1", async () => {
    const { isConditionRequired } = await import("../nachweis/nachweis-io.ts");
    expect(isConditionRequired("technical-assessment-v1", "public-derivative-ready")).toBe(false);
  });
});

// ── Tests: nachweis.validate with V2 gate ──────────────────────────────────

describe("RFC-0872: nachweis.validate gate V2", () => {
  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rfc0872-validate-XXXX-"));
    workspaceRoot = tmpDir;
    await writeFile(join(tmpDir, "package.json"), JSON.stringify({ version: "1.0.0" }) + "\n");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("evaluates technical-assessment with technical-assessment-v1 policy", async () => {
    const cachePath = join(tmpDir, "systems-cache", "test-sys");
    await writeEntitlements(cachePath, ["nachweis"]);
    await writePbpEntity(cachePath, "de", "evidence-source", "tech-rec", {
      type: "evidence-source",
      kind: "technical-assessment",
      slug: "tech-rec",
      titleDe: "Tech",
      titleUk: "Tech",
      items: {
        raw: { role: "raw-result", canonical: true, sha256: SHA256_A },
      },
      assessment: makeAssessment(),
    });

    const { runNachweisValidate } = await import("../nachweis/nachweis-validate.ts");
    const result = await runNachweisValidate(
      makeInput({ system: "test-sys" }),
      makeContext("test-sys"),
    );

    const gate = expectData(result).gateResults.find((g) => g.slug === "tech-rec");
    expect(gate).toBeTruthy();
    expect(gate!.policyId).toBe("technical-assessment-v1");
    // consent-granted should be not_applicable for technical-assessment
    const consentCond = gate!.conditions.find((c) => c.id === "consent-granted");
    expect(consentCond!.required).toBe(false);
    expect(consentCond!.status).toBe("not_applicable");
    // canonical-raw-artifact-verified should be required and pass
    const canonicalCond = gate!.conditions.find((c) => c.id === "canonical-raw-artifact-verified");
    expect(canonicalCond!.required).toBe(true);
    expect(canonicalCond!.status).toBe("pass");
  });

  it("reports TECHNICAL_ASSESSMENT_METADATA_REQUIRED when assessment field missing", async () => {
    const cachePath = join(tmpDir, "systems-cache", "test-sys");
    await writeEntitlements(cachePath, ["nachweis"]);
    await writePbpEntity(cachePath, "de", "evidence-source", "tech-no-assessment", {
      type: "evidence-source",
      kind: "technical-assessment",
      slug: "tech-no-assessment",
      titleDe: "Tech",
      titleUk: "Tech",
      items: {
        raw: { role: "raw-result", canonical: true, sha256: SHA256_A },
      },
    });

    const { runNachweisValidate } = await import("../nachweis/nachweis-validate.ts");
    const result = await runNachweisValidate(
      makeInput({ system: "test-sys" }),
      makeContext("test-sys"),
    );

    const violations = expectData(result).violations;
    expect(
      violations.some((v: { rule: string }) => v.rule === "TECHNICAL_ASSESSMENT_METADATA_REQUIRED"),
    ).toBe(true);
  });

  it("reports TECHNICAL_ASSESSMENT_CANONICAL_RAW_REQUIRED when no canonical raw-result", async () => {
    const cachePath = join(tmpDir, "systems-cache", "test-sys");
    await writeEntitlements(cachePath, ["nachweis"]);
    await writePbpEntity(cachePath, "de", "evidence-source", "tech-no-raw", {
      type: "evidence-source",
      kind: "technical-assessment",
      slug: "tech-no-raw",
      titleDe: "Tech",
      titleUk: "Tech",
      items: {
        report: { role: "report", sha256: SHA256_A },
      },
      assessment: makeAssessment(),
    });

    const { runNachweisValidate } = await import("../nachweis/nachweis-validate.ts");
    const result = await runNachweisValidate(
      makeInput({ system: "test-sys" }),
      makeContext("test-sys"),
    );

    const violations = expectData(result).violations;
    expect(
      violations.some(
        (v: { rule: string }) => v.rule === "TECHNICAL_ASSESSMENT_CANONICAL_RAW_REQUIRED",
      ),
    ).toBe(true);
  });

  it("reports assessment-on-non-technical-kind when assessment field on certificate", async () => {
    const cachePath = join(tmpDir, "systems-cache", "test-sys");
    await writeEntitlements(cachePath, ["nachweis"]);
    await writePbpEntity(cachePath, "de", "evidence-source", "cert-with-assessment", {
      type: "evidence-source",
      kind: "certificate",
      slug: "cert-with-assessment",
      titleDe: "Cert",
      titleUk: "Cert",
      items: { main: { sha256: SHA256_A } },
      assessment: makeAssessment(),
    });

    const { runNachweisValidate } = await import("../nachweis/nachweis-validate.ts");
    const result = await runNachweisValidate(
      makeInput({ system: "test-sys" }),
      makeContext("test-sys"),
    );

    const violations = expectData(result).violations;
    expect(
      violations.some((v: { rule: string }) => v.rule === "assessment-on-non-technical-kind"),
    ).toBe(true);
  });

  it("evaluates certificate with attestation-v1 policy and consent-granted required", async () => {
    const cachePath = join(tmpDir, "systems-cache", "test-sys");
    await writeEntitlements(cachePath, ["nachweis"]);
    await writePbpEntity(cachePath, "de", "evidence-source", "cert-rec", {
      type: "evidence-source",
      kind: "certificate",
      slug: "cert-rec",
      titleDe: "Cert",
      titleUk: "Cert",
      items: { main: { sha256: SHA256_A } },
      // RFC-0886: display field required for consent-granted to be evaluated
      display: { document: "visible", screenshot: "hidden", websiteLink: "hidden" },
    });

    const { runNachweisValidate } = await import("../nachweis/nachweis-validate.ts");
    const result = await runNachweisValidate(
      makeInput({ system: "test-sys" }),
      makeContext("test-sys"),
    );

    const gate = expectData(result).gateResults.find((g) => g.slug === "cert-rec");
    expect(gate).toBeTruthy();
    expect(gate!.policyId).toBe("attestation-v1");
    const consentCond = gate!.conditions.find((c) => c.id === "consent-granted");
    expect(consentCond!.required).toBe(true);
    // No consent entity → fail
    expect(consentCond!.status).toBe("fail");
    // canonical-raw-artifact-verified should be not_applicable for attestation
    const canonicalCond = gate!.conditions.find((c) => c.id === "canonical-raw-artifact-verified");
    expect(canonicalCond!.required).toBe(false);
    expect(canonicalCond!.status).toBe("not_applicable");
  });
});

// ── Tests: locale drift detection ──────────────────────────────────────────

describe("RFC-0872: locale drift detection", () => {
  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rfc0872-drift-XXXX-"));
    workspaceRoot = tmpDir;
    await writeFile(join(tmpDir, "package.json"), JSON.stringify({ version: "1.0.0" }) + "\n");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("reports TECHNICAL_ASSESSMENT_LOCALE_DRIFT when assessment differs across locales", async () => {
    const cachePath = join(tmpDir, "systems-cache", "test-sys");
    await writeEntitlements(cachePath, ["nachweis"], ["de", "uk"]);

    // DE assessment with score 90
    await writePbpEntity(cachePath, "de", "evidence-source", "tech-drift", {
      type: "evidence-source",
      kind: "technical-assessment",
      slug: "tech-drift",
      titleDe: "Tech",
      titleUk: "Tech",
      items: { raw: { role: "raw-result", canonical: true, sha256: SHA256_A } },
      assessment: makeAssessment({
        dimensions: [{ id: "perf", providerLabel: "Performance", score: 90 }],
      }),
    });

    // UK assessment with score 85 — different canonical hash
    await writePbpEntity(cachePath, "uk", "evidence-source", "tech-drift", {
      type: "evidence-source",
      kind: "technical-assessment",
      slug: "tech-drift",
      titleDe: "Tech",
      titleUk: "Tech",
      items: { raw: { role: "raw-result", canonical: true, sha256: SHA256_A } },
      assessment: makeAssessment({
        dimensions: [{ id: "perf", providerLabel: "Performance", score: 85 }],
      }),
    });

    const { runNachweisValidate } = await import("../nachweis/nachweis-validate.ts");
    const result = await runNachweisValidate(
      makeInput({ system: "test-sys" }),
      makeContext("test-sys"),
    );

    const violations = expectData(result).violations;
    expect(
      violations.some((v: { rule: string }) => v.rule === "TECHNICAL_ASSESSMENT_LOCALE_DRIFT"),
    ).toBe(true);
  });

  it("does NOT report locale drift when assessment is identical across locales", async () => {
    const cachePath = join(tmpDir, "systems-cache", "test-sys");
    await writeEntitlements(cachePath, ["nachweis"], ["de", "uk"]);

    const sameAssessment = makeAssessment();
    await writePbpEntity(cachePath, "de", "evidence-source", "tech-no-drift", {
      type: "evidence-source",
      kind: "technical-assessment",
      slug: "tech-no-drift",
      titleDe: "Tech",
      titleUk: "Tech",
      items: { raw: { role: "raw-result", canonical: true, sha256: SHA256_A } },
      assessment: sameAssessment,
    });
    await writePbpEntity(cachePath, "uk", "evidence-source", "tech-no-drift", {
      type: "evidence-source",
      kind: "technical-assessment",
      slug: "tech-no-drift",
      titleDe: "Tech",
      titleUk: "Tech",
      items: { raw: { role: "raw-result", canonical: true, sha256: SHA256_A } },
      assessment: sameAssessment,
    });

    const { runNachweisValidate } = await import("../nachweis/nachweis-validate.ts");
    const result = await runNachweisValidate(
      makeInput({ system: "test-sys" }),
      makeContext("test-sys"),
    );

    const violations = expectData(result).violations;
    expect(
      violations.some((v: { rule: string }) => v.rule === "TECHNICAL_ASSESSMENT_LOCALE_DRIFT"),
    ).toBe(false);
  });
});

// ── Tests: nachweis.withdraw conditional consent ───────────────────────────

describe("RFC-0872: nachweis.withdraw conditional consent", () => {
  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rfc0872-withdraw-XXXX-"));
    workspaceRoot = tmpDir;
    await writeFile(join(tmpDir, "package.json"), JSON.stringify({ version: "1.0.0" }) + "\n");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("revokes consent for attestation-v1 (certificate)", async () => {
    const cachePath = join(tmpDir, "systems-cache", "test-sys");
    await writeEntitlements(cachePath, ["nachweis"]);
    await writePbpEntity(cachePath, "de", "evidence-source", "cert-rec", {
      type: "evidence-source",
      kind: "certificate",
      slug: "cert-rec",
      titleDe: "Cert",
      titleUk: "Cert",
      recordStatus: "published",
      publication: { visibility: "public", publishedAt: "2026-01-01T00:00:00Z" },
      items: { main: { sha256: SHA256_A } },
    });
    await writePbpEntity(cachePath, "de", "consent", "cert-rec", {
      type: "consent",
      slug: "cert-rec",
      consentScope: {
        document: { status: "granted", grantedAt: "2026-01-01T00:00:00Z", method: "none" },
        screenshot: { status: "not_requested", grantedAt: null, method: "none" },
        websiteLink: { status: "not_requested", grantedAt: null, method: "none" },
      },
    });

    const { runNachweisWithdraw } = await import("../nachweis/nachweis-withdraw.ts");
    const result = await runNachweisWithdraw(
      makeInput({ system: "test-sys", slug: "cert-rec" }),
      makeContext("test-sys"),
    );

    expect(result.exitCode).toBe(0);
    expect(expectData(result).withdrawn).toBe(true);

    // Verify consent was revoked
    const consentFile = join(
      cachePath,
      "src",
      "content",
      "business-profile",
      "de",
      "trust",
      "consents",
      "cert-rec.md",
    );
    const rawConsent = await readFile(consentFile, "utf8");
    expect(rawConsent).toContain("denied");
  });

  it("does NOT revoke consent for technical-assessment-v1", async () => {
    const cachePath = join(tmpDir, "systems-cache", "test-sys");
    await writeEntitlements(cachePath, ["nachweis"]);
    await writePbpEntity(cachePath, "de", "evidence-source", "tech-rec", {
      type: "evidence-source",
      kind: "technical-assessment",
      slug: "tech-rec",
      titleDe: "Tech",
      titleUk: "Tech",
      recordStatus: "published",
      publication: { visibility: "public", publishedAt: "2026-01-01T00:00:00Z" },
      items: { raw: { role: "raw-result", canonical: true, sha256: SHA256_A } },
      assessment: makeAssessment(),
    });
    // Write a consent entity that should NOT be revoked
    await writePbpEntity(cachePath, "de", "consent", "tech-rec", {
      type: "consent",
      slug: "tech-rec",
      consentScope: {
        document: { status: "granted", grantedAt: "2026-01-01T00:00:00Z", method: "none" },
        screenshot: { status: "not_requested", grantedAt: null, method: "none" },
        websiteLink: { status: "not_requested", grantedAt: null, method: "none" },
      },
    });

    const { runNachweisWithdraw } = await import("../nachweis/nachweis-withdraw.ts");
    const result = await runNachweisWithdraw(
      makeInput({ system: "test-sys", slug: "tech-rec" }),
      makeContext("test-sys"),
    );

    expect(result.exitCode).toBe(0);
    expect(expectData(result).withdrawn).toBe(true);

    // Verify consent was NOT revoked — still granted
    const consentFile = join(
      cachePath,
      "src",
      "content",
      "business-profile",
      "de",
      "trust",
      "consents",
      "tech-rec.md",
    );
    const rawConsent = await readFile(consentFile, "utf8");
    expect(rawConsent).toContain("granted");
    expect(rawConsent).not.toContain("revoked");
  });
});

// ── Tests: nachweis.manifest observation identity ──────────────────────────

describe("RFC-0872: nachweis.manifest.generate observation identity", () => {
  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rfc0872-manifest-XXXX-"));
    workspaceRoot = tmpDir;
    await writeFile(join(tmpDir, "package.json"), JSON.stringify({ version: "1.0.0" }) + "\n");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("includes observation identity fields for technical-assessment records", async () => {
    const cachePath = join(tmpDir, "systems-cache", "test-sys");
    await writeEntitlements(cachePath, ["nachweis"]);
    await writePbpEntity(cachePath, "de", "evidence-source", "tech-manifest", {
      type: "evidence-source",
      kind: "technical-assessment",
      slug: "tech-manifest",
      titleDe: "Tech",
      titleUk: "Tech",
      recordStatus: "published",
      publication: { visibility: "public", publishedAt: "2026-01-01T00:00:00Z" },
      items: { raw: { sha256: SHA256_A } },
      assessment: makeAssessment({
        seriesId: "series-manifest",
        observationId: "obs-manifest",
        observedAt: "2026-07-15T12:00:00Z",
        provider: { id: "provider-manifest", name: "Manifest Provider" },
      }),
    });

    const { runNachweisManifestGenerate } = await import("../nachweis/nachweis-manifest.ts");
    const result = await runNachweisManifestGenerate(
      makeInput({ system: "test-sys" }),
      makeContext("test-sys"),
    );

    expect(result.exitCode).toBe(0);
    const records = expectData(result).records;
    expect(records.length).toBe(1);
    const record = records[0];
    expect(record.kind).toBe("technical-assessment");
    expect(record.seriesId).toBe("series-manifest");
    expect(record.observationId).toBe("obs-manifest");
    expect(record.observedAt).toBe("2026-07-15T12:00:00Z");
    expect(record.assessmentProviderId).toBe("provider-manifest");
  });

  it("does NOT include observation identity fields for non-technical-assessment records", async () => {
    const cachePath = join(tmpDir, "systems-cache", "test-sys");
    await writeEntitlements(cachePath, ["nachweis"]);
    await writePbpEntity(cachePath, "de", "evidence-source", "cert-manifest", {
      type: "evidence-source",
      kind: "certificate",
      slug: "cert-manifest",
      titleDe: "Cert",
      titleUk: "Cert",
      recordStatus: "published",
      publication: { visibility: "public", publishedAt: "2026-01-01T00:00:00Z" },
      items: { main: { sha256: SHA256_A } },
    });

    const { runNachweisManifestGenerate } = await import("../nachweis/nachweis-manifest.ts");
    const result = await runNachweisManifestGenerate(
      makeInput({ system: "test-sys" }),
      makeContext("test-sys"),
    );

    expect(result.exitCode).toBe(0);
    const records = expectData(result).records;
    expect(records.length).toBe(1);
    const record = records[0];
    expect(record.kind).toBeUndefined();
    expect(record.seriesId).toBeUndefined();
    expect(record.observationId).toBeUndefined();
  });
});

// ── Tests: nachweis.publish V2 gate ────────────────────────────────────────

describe("RFC-0872: nachweis.publish V2 gate", () => {
  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rfc0872-publish-XXXX-"));
    workspaceRoot = tmpDir;
    await writeFile(join(tmpDir, "package.json"), JSON.stringify({ version: "1.0.0" }) + "\n");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("fails publish for technical-assessment without canonical raw artifact", async () => {
    const cachePath = join(tmpDir, "systems-cache", "test-sys");
    await writeEntitlements(cachePath, ["nachweis"]);
    await writePbpEntity(cachePath, "de", "evidence-source", "tech-publish", {
      type: "evidence-source",
      kind: "technical-assessment",
      slug: "tech-publish",
      titleDe: "Tech",
      titleUk: "Tech",
      items: { report: { role: "report", sha256: SHA256_A } },
      assessment: makeAssessment(),
    });

    // Write bordbuch entries for approval + N3 + legal
    await writeBordbuchEntry(cachePath, {
      schemaVersion: "1.0.0",
      id: "event-000001",
      systemId: "test-sys",
      occurredAt: "2026-01-01T00:00:00Z",
      kind: "nachweis-record",
      status: "done",
      actor: "agent",
      summary: "approved",
      metadata: { verificationLevel: "N3", legalContentCheckPassed: true },
      previousHash: null,
      hash: "sha256:fake",
    });

    const { runNachweisPublish } = await import("../nachweis/nachweis-publish.ts");
    const result = await runNachweisPublish(
      makeInput({ system: "test-sys", slug: "tech-publish" }),
      makeContext("test-sys"),
    );

    expect(result.exitCode).toBe(1);
    expect(expectData(result).published).toBe(false);
    const gate = expectData(result).gateResult;
    expect(gate.policyId).toBe("technical-assessment-v1");
    const canonicalCond = gate.conditions.find((c) => c.id === "canonical-raw-artifact-verified");
    expect(canonicalCond!.status).toBe("fail");
  });
});

// ── Tests: PBP schema validation ───────────────────────────────────────────

describe("RFC-0872: PBP evidence-source schema", () => {
  function makeValidEntity(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      schema: "pbp/evidence-source@1",
      id: "tech-assessment-001",
      type: "evidence-source",
      status: "draft",
      name: "Test Entity",
      kind: "technical-assessment",
      slug: "tech-assessment-001",
      authority: { kind: "test" },
      items: {
        raw: { role: "raw-result", canonical: true, sha256: SHA256_A },
      },
      assessment: makeAssessment(),
      display: { document: "visible", screenshot: "hidden", websiteLink: "hidden" },
      ...overrides,
    };
  }

  it("validates technical-assessment kind with assessment field", async () => {
    const { evidenceSourceSchema } =
      await import("@warpgogol/werkstatt-site/domain/pbp/schemas/evidence-source");
    expect(() => evidenceSourceSchema.parse(makeValidEntity())).not.toThrow();
  });

  it("rejects assessment field on certificate kind (RFC-0872 section 3: assessment MUST be absent)", async () => {
    const { evidenceSourceSchema } =
      await import("@warpgogol/werkstatt-site/domain/pbp/schemas/evidence-source");
    const entity = makeValidEntity({
      kind: "certificate",
      items: { main: { sha256: SHA256_A } },
    });
    expect(() => evidenceSourceSchema.parse(entity)).toThrow();
  });

  it("validates artifact role enum values", async () => {
    const { evidenceSourceSchema } =
      await import("@warpgogol/werkstatt-site/domain/pbp/schemas/evidence-source");
    const entity = makeValidEntity({
      items: {
        raw: { role: "raw-result", canonical: true, sha256: SHA256_A },
        report: { role: "report" },
        screenshot: { role: "screenshot" },
        summary: { role: "summary" },
        methodology: { role: "methodology" },
      },
    });
    expect(() => evidenceSourceSchema.parse(entity)).not.toThrow();
  });

  it("rejects invalid artifact role value", async () => {
    const { evidenceSourceSchema } =
      await import("@warpgogol/werkstatt-site/domain/pbp/schemas/evidence-source");
    const entity = makeValidEntity({
      items: { bad: { role: "invalid-role" } },
    });
    expect(() => evidenceSourceSchema.parse(entity)).toThrow();
  });
});
