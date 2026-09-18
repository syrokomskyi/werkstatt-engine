/*
<MODULE_CONTRACT>
  <purpose>RFC-1051: test RFC-0885 migrator — consent status mapping, evidence-source display defaults, idempotency.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1051: initial rfc-0885 migrator test.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { rfc0885Migrator } from "../rfc-0885.ts";
import type { SternsystemData, MigrationContext } from "../types.ts";

const ctx: MigrationContext = {
  systemId: "test",
  missionId: "test-mission",
  logger: { info: () => {} },
};

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "rfc-0885-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

async function writeConsentFile(
  lang: string,
  filename: string,
  frontmatter: Record<string, unknown>,
): Promise<void> {
  const dir = path.join(tmpDir, "src", "content", "business-profile", lang, "consent");
  await fs.mkdir(dir, { recursive: true });
  const content = `---\n${Object.entries(frontmatter)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join("\n")}\n---\nBody`;
  await fs.writeFile(path.join(dir, filename), content);
}

async function writeEvidenceSourceFile(
  lang: string,
  filename: string,
  frontmatter: Record<string, unknown>,
): Promise<void> {
  const dir = path.join(tmpDir, "src", "content", "business-profile", lang, "evidence-source");
  await fs.mkdir(dir, { recursive: true });
  const content = `---\n${Object.entries(frontmatter)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join("\n")}\n---\nBody`;
  await fs.writeFile(path.join(dir, filename), content);
}

test("rfc-0885 migrator has correct id and version metadata", () => {
  expect(rfc0885Migrator.id).toBe("rfc-0885");
  expect(rfc0885Migrator.fromVersion).toBe("6.22.0");
  expect(rfc0885Migrator.toVersion).toBe("6.23.0");
  expect(rfc0885Migrator.description).toContain("consent");
});

test("rfc-0885 migrates granted consent to consentScope with document granted", async () => {
  const consentPath = path.join(
    tmpDir,
    "src",
    "content",
    "business-profile",
    "de",
    "consent",
    "test.md",
  );
  await writeConsentFile("de", "test.md", {
    consentStatus: "granted",
    grantedAt: "2026-01-01",
    method: "email",
  });

  await rfc0885Migrator.transform({ rootPath: tmpDir, dataPaths: [] }, ctx);

  const content = await fs.readFile(consentPath, "utf-8");
  expect(content).not.toContain("consentStatus:");
  expect(content).toContain("consentScope:");
});

test("rfc-0885 migrates revoked consent to denied document", async () => {
  const consentPath = path.join(
    tmpDir,
    "src",
    "content",
    "business-profile",
    "de",
    "consent",
    "revoked.md",
  );
  await writeConsentFile("de", "revoked.md", {
    consentStatus: "revoked",
    grantedAt: null,
    method: "none",
  });

  await rfc0885Migrator.transform({ rootPath: tmpDir, dataPaths: [] }, ctx);

  const content = await fs.readFile(consentPath, "utf-8");
  expect(content).not.toContain("consentStatus:");
  expect(content).toContain("consentScope:");
});

test("rfc-0885 adds default display to Nachweis evidence-source kinds", async () => {
  const esPath = path.join(
    tmpDir,
    "src",
    "content",
    "business-profile",
    "de",
    "evidence-source",
    "cert.md",
  );
  await writeEvidenceSourceFile("de", "cert.md", {
    kind: "certificate",
    title: "Test Certificate",
  });

  await rfc0885Migrator.transform({ rootPath: tmpDir, dataPaths: [] }, ctx);

  const content = await fs.readFile(esPath, "utf-8");
  expect(content).toContain("display");
});

test("rfc-0885 skips non-Nachweis evidence-source kinds", async () => {
  const esPath = path.join(
    tmpDir,
    "src",
    "content",
    "business-profile",
    "de",
    "evidence-source",
    "other.md",
  );
  await writeEvidenceSourceFile("de", "other.md", {
    kind: "other-kind",
    title: "Other",
  });

  await rfc0885Migrator.transform({ rootPath: tmpDir, dataPaths: [] }, ctx);

  const content = await fs.readFile(esPath, "utf-8");
  expect(content).not.toContain("display");
});

test("rfc-0885 is idempotent — running twice produces same result", async () => {
  await writeConsentFile("de", "idemp.md", {
    consentStatus: "granted",
    grantedAt: "2026-01-01",
    method: "email",
  });

  const data: SternsystemData = { rootPath: tmpDir, dataPaths: [] };
  await rfc0885Migrator.transform(data, ctx);
  const afterFirst = await fs.readFile(
    path.join(tmpDir, "src", "content", "business-profile", "de", "consent", "idemp.md"),
    "utf-8",
  );

  await rfc0885Migrator.transform(data, ctx);
  const afterSecond = await fs.readFile(
    path.join(tmpDir, "src", "content", "business-profile", "de", "consent", "idemp.md"),
    "utf-8",
  );

  expect(afterSecond).toBe(afterFirst);
});

test("rfc-0885 handles missing business-profile directory gracefully", async () => {
  const data: SternsystemData = { rootPath: tmpDir, dataPaths: [] };
  await expect(rfc0885Migrator.transform(data, ctx)).resolves.toEqual(data);
});
