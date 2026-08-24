/*
<MODULE_CONTRACT>
  <purpose>
    Unit tests for RFC-0880: NACHWEIS-SLUG-01 validation rule that enforces
    mandatory explicit slug in frontmatter of Nachweis evidence records.
  </purpose>
  <keywords>RFC-0880, nachweis, slug, NACHWEIS-SLUG-01, validation, unit-test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0880: initial tests for NACHWEIS-SLUG-01 — slug absent, empty, whitespace, present, draft, non-Nachweis kind.</item>
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
  return {
    ...actual,
    appendAndCommitBordbuch: vi.fn(async () => ({
      entry: { id: "event-000001", hash: "sha256:dummy" },
      commitResult: { commitSha: null, pushed: false, error: null },
    })),
    appendBatchAndCommitBordbuch: vi.fn(async () => []),
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

const SHA256_A = "a".repeat(64);

// ── Tests: NACHWEIS-SLUG-01 ─────────────────────────────────────────────────

describe("RFC-0880: NACHWEIS-SLUG-01", () => {
  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rfc0880-slug-XXXX-"));
    workspaceRoot = tmpDir;
    await writeFile(join(tmpDir, "package.json"), JSON.stringify({ version: "1.0.0" }) + "\n");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("emits NACHWEIS-SLUG-01 when slug is absent", async () => {
    const cachePath = join(tmpDir, "systems-cache", "test-sys");
    await writeEntitlements(cachePath, ["nachweis"]);
    await writePbpEntity(cachePath, "de", "evidence-source", "no-slug-rec", {
      schema: "pbp/evidence-source@1",
      type: "evidence-source",
      kind: "client-statement",
      status: "published",
      name: "No Slug Record",
      authority: { kind: "platform" },
      recordStatus: "published",
      items: { main: { sha256: SHA256_A } },
    });

    const { runNachweisValidate } = await import("../nachweis/nachweis-validate.ts");
    const result = await runNachweisValidate(
      makeInput({ system: "test-sys" }),
      makeContext("test-sys"),
    );

    const violations = expectData(result).violations;
    const slugViolation = violations.find((v) => v.rule === "NACHWEIS-SLUG-01");
    expect(slugViolation).toBeTruthy();
    expect(slugViolation!.recordId).toBe("no-slug-rec");
  });

  it("emits NACHWEIS-SLUG-01 when slug is empty string", async () => {
    const cachePath = join(tmpDir, "systems-cache", "test-sys");
    await writeEntitlements(cachePath, ["nachweis"]);
    await writePbpEntity(cachePath, "de", "evidence-source", "empty-slug-rec", {
      schema: "pbp/evidence-source@1",
      type: "evidence-source",
      kind: "client-statement",
      status: "published",
      name: "Empty Slug Record",
      authority: { kind: "platform" },
      slug: "",
      recordStatus: "published",
      items: { main: { sha256: SHA256_A } },
    });

    const { runNachweisValidate } = await import("../nachweis/nachweis-validate.ts");
    const result = await runNachweisValidate(
      makeInput({ system: "test-sys" }),
      makeContext("test-sys"),
    );

    const violations = expectData(result).violations;
    const slugViolation = violations.find((v) => v.rule === "NACHWEIS-SLUG-01");
    expect(slugViolation).toBeTruthy();
  });

  it("emits NACHWEIS-SLUG-01 when slug is whitespace-only", async () => {
    const cachePath = join(tmpDir, "systems-cache", "test-sys");
    await writeEntitlements(cachePath, ["nachweis"]);
    await writePbpEntity(cachePath, "de", "evidence-source", "ws-slug-rec", {
      schema: "pbp/evidence-source@1",
      type: "evidence-source",
      kind: "client-statement",
      status: "published",
      name: "Whitespace Slug Record",
      authority: { kind: "platform" },
      slug: "   ",
      recordStatus: "published",
      items: { main: { sha256: SHA256_A } },
    });

    const { runNachweisValidate } = await import("../nachweis/nachweis-validate.ts");
    const result = await runNachweisValidate(
      makeInput({ system: "test-sys" }),
      makeContext("test-sys"),
    );

    const violations = expectData(result).violations;
    const slugViolation = violations.find((v) => v.rule === "NACHWEIS-SLUG-01");
    expect(slugViolation).toBeTruthy();
  });

  it("does NOT emit NACHWEIS-SLUG-01 when slug is present", async () => {
    const cachePath = join(tmpDir, "systems-cache", "test-sys");
    await writeEntitlements(cachePath, ["nachweis"]);
    await writePbpEntity(cachePath, "de", "evidence-source", "good-slug-rec", {
      schema: "pbp/evidence-source@1",
      type: "evidence-source",
      kind: "client-statement",
      status: "published",
      name: "Good Slug Record",
      authority: { kind: "platform" },
      slug: "cloudflare-cf-ar-01",
      recordStatus: "published",
      items: { main: { sha256: SHA256_A } },
    });

    const { runNachweisValidate } = await import("../nachweis/nachweis-validate.ts");
    const result = await runNachweisValidate(
      makeInput({ system: "test-sys" }),
      makeContext("test-sys"),
    );

    const violations = expectData(result).violations;
    const slugViolation = violations.find((v) => v.rule === "NACHWEIS-SLUG-01");
    expect(slugViolation).toBeUndefined();
  });

  it("emits NACHWEIS-SLUG-01 for draft records without slug (all Nachweis-kind records checked)", async () => {
    const cachePath = join(tmpDir, "systems-cache", "test-sys");
    await writeEntitlements(cachePath, ["nachweis"]);
    await writePbpEntity(cachePath, "de", "evidence-source", "draft-no-slug", {
      schema: "pbp/evidence-source@1",
      type: "evidence-source",
      kind: "client-statement",
      status: "draft",
      name: "Draft No Slug",
      authority: { kind: "platform" },
      recordStatus: "draft",
      items: { main: { sha256: SHA256_A } },
    });

    const { runNachweisValidate } = await import("../nachweis/nachweis-validate.ts");
    const result = await runNachweisValidate(
      makeInput({ system: "test-sys" }),
      makeContext("test-sys"),
    );

    const violations = expectData(result).violations;
    const slugViolation = violations.find((v) => v.rule === "NACHWEIS-SLUG-01");
    expect(slugViolation).toBeTruthy();
  });

  it("does NOT emit NACHWEIS-SLUG-01 for non-Nachweis kinds without slug", async () => {
    const cachePath = join(tmpDir, "systems-cache", "test-sys");
    await writeEntitlements(cachePath, ["nachweis"]);
    await writePbpEntity(cachePath, "de", "evidence-source", "external-web-no-slug", {
      schema: "pbp/evidence-source@1",
      type: "evidence-source",
      kind: "external-web-sources",
      status: "published",
      name: "External Web Sources",
      authority: { kind: "platform" },
      recordStatus: "published",
      items: { main: { sha256: SHA256_A } },
    });

    const { runNachweisValidate } = await import("../nachweis/nachweis-validate.ts");
    const result = await runNachweisValidate(
      makeInput({ system: "test-sys" }),
      makeContext("test-sys"),
    );

    const violations = expectData(result).violations;
    const slugViolation = violations.find((v) => v.rule === "NACHWEIS-SLUG-01");
    expect(slugViolation).toBeUndefined();
  });
});
