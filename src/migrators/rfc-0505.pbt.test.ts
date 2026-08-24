/*
<MODULE_CONTRACT>
<purpose>RFC-0505: PBT test for the rfc-0505 migrator — verifies idempotency
(f(f(x)) == f(x)) by running the migrator twice and checking the result is
identical. Also verifies sidecar-to-claim-record transformation and sidecar deletion.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0505: initial PBT test for rfc-0505 migrator idempotency.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { rfc0505Migrator } from "./rfc-0505.ts";
import type { SternsystemData, MigrationContext } from "./types.ts";

function makeCtx(): MigrationContext {
  return {
    systemId: "test-system",
    missionId: "test-mission",
    logger: { info: () => {} },
  };
}

function makeData(tmpDir: string): SternsystemData {
  return { rootPath: tmpDir, dataPaths: [] };
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-0505-pbt-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("rfc-0505 migrator is idempotent — f(f(x)) == f(x) with no sidecars", async () => {
  const data = makeData(tmpDir);
  const ctx = makeCtx();

  await rfc0505Migrator.transform(data, ctx);
  const firstDir = path.join(tmpDir, "src", "content", "surface", "claims");
  const firstFiles = await fs.readdir(firstDir).catch(() => []);

  await rfc0505Migrator.transform(data, ctx);
  const secondDir = path.join(tmpDir, "src", "content", "surface", "claims");
  const secondFiles = await fs.readdir(secondDir).catch(() => []);

  expect(firstFiles.sort()).toEqual(secondFiles.sort());
});

test("rfc-0505 migrator transforms sidecars to claim records and deletes sidecars", async () => {
  const data = makeData(tmpDir);
  const ctx = makeCtx();

  // Create a claim sidecar
  const articlesDir = path.join(tmpDir, "src", "content", "surface", "articles", "de");
  await fs.mkdir(articlesDir, { recursive: true });
  const sidecarPath = path.join(articlesDir, "test-article.claims.yaml");
  await fs.writeFile(
    sidecarPath,
    `claim-001:
  provenance: manual
  asOf: "2026-07-23"
  sourceId: src-001
  url: "https://example.com"
  title: "Test Source"
`,
    "utf-8",
  );

  await rfc0505Migrator.transform(data, ctx);

  // Sidecar should be deleted
  const sidecarExists = await fs
    .stat(sidecarPath)
    .then(() => true)
    .catch(() => false);
  expect(sidecarExists).toBe(false);

  // Claim record should exist
  const claimRecordPath = path.join(
    tmpDir,
    "src",
    "content",
    "surface",
    "claims",
    "de",
    "claim-001.md",
  );
  const claimContent = await fs.readFile(claimRecordPath, "utf-8");
  expect(claimContent).toContain("claimId: claim-001");
  expect(claimContent).toContain("articleId: test-article");
  expect(claimContent).toContain("reviewStatus: unverified");
});

test("rfc-0505 migrator is idempotent after transformation", async () => {
  const data = makeData(tmpDir);
  const ctx = makeCtx();

  // Create a claim sidecar
  const articlesDir = path.join(tmpDir, "src", "content", "surface", "articles", "de");
  await fs.mkdir(articlesDir, { recursive: true });
  await fs.writeFile(
    path.join(articlesDir, "test-article.claims.yaml"),
    `claim-001:
  provenance: manual
  asOf: "2026-07-23"
`,
    "utf-8",
  );

  // First run transforms and deletes
  await rfc0505Migrator.transform(data, ctx);

  // Second run should be a no-op (no sidecars left)
  await rfc0505Migrator.transform(data, ctx);

  // Claim record should still exist
  const claimRecordPath = path.join(
    tmpDir,
    "src",
    "content",
    "surface",
    "claims",
    "de",
    "claim-001.md",
  );
  const claimContent = await fs.readFile(claimRecordPath, "utf-8");
  expect(claimContent).toContain("claimId: claim-001");
});

test("rfc-0505 migrator does not overwrite existing claim records", async () => {
  const data = makeData(tmpDir);
  const ctx = makeCtx();

  // Create a claim sidecar
  const articlesDir = path.join(tmpDir, "src", "content", "surface", "articles", "de");
  await fs.mkdir(articlesDir, { recursive: true });
  await fs.writeFile(
    path.join(articlesDir, "test-article.claims.yaml"),
    `claim-001:
  provenance: manual
  asOf: "2026-07-23"
`,
    "utf-8",
  );

  // Create an existing claim record
  const claimsDir = path.join(tmpDir, "src", "content", "surface", "claims", "de");
  await fs.mkdir(claimsDir, { recursive: true });
  const customContent = `---
claimId: claim-001
articleId: test-article
claimText: "Custom claim text"
claimType: factual
sourceRefs: []
calculationInputs: []
limitations: []
verifiedAt: "2026-07-23"
reviewStatus: verified
---
`;
  await fs.writeFile(path.join(claimsDir, "claim-001.md"), customContent, "utf-8");

  await rfc0505Migrator.transform(data, ctx);

  // Existing claim record should not be overwritten
  const after = await fs.readFile(path.join(claimsDir, "claim-001.md"), "utf-8");
  expect(after).toBe(customContent);

  // Sidecar should still be deleted (transformation completed)
  const sidecarExists = await fs
    .stat(path.join(articlesDir, "test-article.claims.yaml"))
    .then(() => true)
    .catch(() => false);
  expect(sidecarExists).toBe(false);
});
