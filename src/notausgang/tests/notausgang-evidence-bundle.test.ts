/*
<MODULE_CONTRACT>
<purpose>RFC-1120: unit tests for evidence bundling — eligibility matrix (published claim ref + public visibility + consent scopes), fail-closed hash/R2 paths, integrity.txt emission.</purpose>
<non-goals>
  <item>Do not hit real R2 — the download function is injected.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1120: initial evidence-bundle tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { byteHash } from "@warpgogol/werkstatt-engine/fingerprint";
import { bundleEvidenceArtifacts } from "../evidence-bundle.ts";

let siteDir: string;
let stagingDir: string;

const ARTIFACT_BYTES = new TextEncoder().encode("evidence-pdf-bytes");
const ARTIFACT_SHA = byteHash(ARTIFACT_BYTES).replace(/^sha256:/, "");

function entityMd(frontmatter: Record<string, unknown>): string {
  return `---\n${stringifyYaml(frontmatter)}---\n\n`;
}

async function writeEntity(
  type: "evidence" | "claims" | "consents",
  slug: string,
  frontmatter: Record<string, unknown>,
): Promise<void> {
  const dir = join(siteDir, "src", "content", "business-profile", "de", "trust", type);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${slug}.md`), entityMd(frontmatter), "utf8");
}

function evidenceSource(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: "pbp/evidence-source@1",
    id: "https://example.com/id/evidence/src-a",
    type: "evidence-source",
    status: "published",
    name: "Source A",
    kind: "external-web-sources",
    slug: "src-a",
    recordId: "nr_src-a",
    version: 1,
    authority: { kind: "operator-attested" },
    publication: { visibility: "public", publishedAt: "2026-01-01T00:00:00Z" },
    items: {
      doc: {
        sha256: ARTIFACT_SHA,
        storage: "private",
        mediaType: "application/pdf",
        r2Path: "sys/private/nr_src-a/v1/source.pdf",
      },
    },
    ...overrides,
  };
}

function publishedClaim(evidenceSlug = "src-a"): Record<string, unknown> {
  return {
    schema: "pbp/claim@1",
    id: "https://example.com/id/claim/c1",
    type: "claim",
    status: "published",
    name: "Claim",
    evidenceRefs: {
      primary: {
        ref: `https://example.com/id/evidence/${evidenceSlug}`,
        expectedType: "evidence-source",
      },
    },
  };
}

const fakeDownload = async (_r2Path: string): Promise<Uint8Array> => ARTIFACT_BYTES;

async function bundle() {
  return bundleEvidenceArtifacts({
    siteDir,
    stagingDir,
    systemId: "sys",
    download: fakeDownload,
  });
}

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), "na-evidence-"));
  siteDir = join(root, "site");
  stagingDir = join(root, "staging");
  await mkdir(join(siteDir, "src", "content"), { recursive: true });
  await writeFile(
    join(siteDir, "src", "content", "system.md"),
    entityMd({ app: "t", version: "1.0.0", i18n: { default: "de", supported: { de: {} } } }),
    "utf8",
  );
  await mkdir(stagingDir, { recursive: true });
});

afterEach(async () => {
  await rm(join(siteDir, ".."), { recursive: true, force: true });
});

test("bundles an eligible source: published claim + public + consent trivially granted", async () => {
  await writeEntity("evidence", "src-a", evidenceSource());
  await writeEntity("claims", "c1", publishedClaim());

  const result = await bundle();

  expect(result.verdicts["src-a"].verdict).toBe("bundled");
  expect(result.bundledSources).toBe(1);
  expect(result.bundledArtifacts).toBe(1);
  const artifact = join(stagingDir, "evidence", "src-a", "doc", "source.pdf");
  expect(existsSync(artifact)).toBe(true);
  const integrity = await readFile(join(stagingDir, "evidence", "src-a", "integrity.txt"), "utf8");
  expect(integrity).toBe(`${ARTIFACT_SHA}  doc/source.pdf\n`);
});

test("excludes a source with no published claim reference", async () => {
  await writeEntity("evidence", "src-a", evidenceSource());
  await writeEntity("claims", "c1", { ...publishedClaim(), status: "draft" });

  const result = await bundle();
  expect(result.verdicts["src-a"].verdict).toBe("excluded:no-published-claims");
  expect(existsSync(join(stagingDir, "evidence", "src-a"))).toBe(false);
});

test("excludes a source without public visibility", async () => {
  await writeEntity(
    "evidence",
    "src-a",
    evidenceSource({ publication: { visibility: "private" } }),
  );
  await writeEntity("claims", "c1", publishedClaim());

  const result = await bundle();
  expect(result.verdicts["src-a"].verdict).toBe("excluded:not-public");
});

test("excludes a Nachweis source when consent scope is not granted", async () => {
  await writeEntity(
    "evidence",
    "src-b",
    evidenceSource({
      id: "https://example.com/id/evidence/src-b",
      slug: "src-b",
      kind: "client-statement",
      display: { document: "visible", screenshot: "hidden", websiteLink: "hidden" },
    }),
  );
  await writeEntity("claims", "c1", publishedClaim("src-b"));
  // consent file exists but document aspect is pending
  await writeEntity("consents", "src-b", {
    type: "consent",
    status: "published",
    consentScope: {
      document: { status: "pending" },
      screenshot: { status: "pending" },
      websiteLink: { status: "pending" },
    },
  });

  const result = await bundle();
  expect(result.verdicts["src-b"].verdict).toBe("excluded:consent-not-granted");
});

test("bundles a Nachweis source when the visible aspect consent is granted", async () => {
  await writeEntity(
    "evidence",
    "src-b",
    evidenceSource({
      id: "https://example.com/id/evidence/src-b",
      slug: "src-b",
      kind: "client-statement",
      display: { document: "visible", screenshot: "hidden", websiteLink: "hidden" },
    }),
  );
  await writeEntity("claims", "c1", publishedClaim("src-b"));
  await writeEntity("consents", "src-b", {
    type: "consent",
    status: "published",
    consentScope: {
      document: { status: "granted", grantedAt: "2026-01-01T00:00:00Z" },
      screenshot: { status: "pending" },
      websiteLink: { status: "pending" },
    },
  });

  const result = await bundle();
  expect(result.verdicts["src-b"].verdict).toBe("bundled");
});

test("fails closed on SHA-256 mismatch between recorded hash and downloaded bytes", async () => {
  await writeEntity(
    "evidence",
    "src-a",
    evidenceSource({
      items: {
        doc: {
          sha256: "0".repeat(64),
          storage: "private",
          r2Path: "sys/private/nr_src-a/v1/source.pdf",
        },
      },
    }),
  );
  await writeEntity("claims", "c1", publishedClaim());

  await expect(bundle()).rejects.toThrow(/integrity mismatch/);
});

test("fails closed when an eligible artifact is unreachable in R2", async () => {
  await writeEntity("evidence", "src-a", evidenceSource());
  await writeEntity("claims", "c1", publishedClaim());

  await expect(
    bundleEvidenceArtifacts({
      siteDir,
      stagingDir,
      systemId: "sys",
      download: async () => {
        throw new Error("R2 unavailable");
      },
    }),
  ).rejects.toThrow(/unreachable/);
});

test("marks URL-only sources as external-reference", async () => {
  await writeEntity(
    "evidence",
    "src-a",
    evidenceSource({
      items: { ext: { url: "https://registry.example.com/record/1", retrievedAt: "2026-01-01" } },
    }),
  );
  await writeEntity("claims", "c1", publishedClaim());

  const result = await bundle();
  expect(result.verdicts["src-a"].verdict).toBe("external-reference");
});

test("emits an empty evidence/ directory when no sources exist", async () => {
  const result = await bundle();
  expect(result.verdicts).toEqual({});
  expect(result.bundledSources).toBe(0);
  expect(existsSync(join(stagingDir, "evidence"))).toBe(true);
});
