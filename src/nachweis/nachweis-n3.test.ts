/*
<MODULE_CONTRACT>
  <purpose>RFC-0715/RFC-0871: unit tests for nachweis.key.ensure, nachweis.sign, nachweis.timestamp, nachweis.verify-signature, and N3 gate in nachweis.approve.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0715: initial N3 crypto verification unit tests.</item>
  <item>RFC-0871: add tests for timestamp assurance, legacy projection, and qualification evidence validation.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { canonicalBytes } from "@warpgogol/werkstatt-engine/signing";
import { getPublicKey } from "@warpgogol/werkstatt-engine/signing";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";
import type { BordbuchEntry } from "@warpgogol/werkstatt-engine/schemas";
import { computeEntryHash } from "../bordbuch/bordbuch-io.ts";
import { runNachweisKeyEnsure, ensureNachweisKey } from "./nachweis-key-ensure.ts";
import { runNachweisSign } from "./nachweis-sign.ts";
import { runNachweisTimestamp } from "./nachweis-timestamp.ts";
import { runNachweisVerifySignature } from "./nachweis-verify-signature.ts";
import { runNachweisApprove } from "./nachweis-approve.ts";

let tmpDir: string;
const systemId = "test-system";

function mockContext(workspaceRoot: string): KernelRuntimeContext {
  return {
    workspaceRoot,
    logger: {
      info: () => {},
      success: () => {},
      error: () => {},
      warn: () => {},
      event: () => {},
      getEvents: () => [],
    },
  } as unknown as KernelRuntimeContext;
}

function makeInput(flags: Record<string, unknown>): KernelCommandInput {
  return {
    commandName: "nachweis.test",
    flags,
  } as unknown as KernelCommandInput;
}

function makeEntry(
  overrides: Partial<BordbuchEntry> &
    Pick<BordbuchEntry, "id" | "kind" | "missionId" | "occurredAt" | "summary">,
  prevHash: string | null,
): BordbuchEntry {
  const base: Omit<BordbuchEntry, "hash"> = {
    schemaVersion: "1.0.0",
    id: overrides.id,
    systemId,
    occurredAt: overrides.occurredAt,
    kind: overrides.kind,
    status: "done",
    missionId: overrides.missionId,
    releaseId: null,
    actor: "agent",
    summary: overrides.summary,
    previousHash: prevHash,
    metadata: overrides.metadata,
  };
  const hash = computeEntryHash(base);
  return { ...base, hash };
}

async function writeBordbuch(entries: BordbuchEntry[]): Promise<void> {
  const cacheDir = path.join(tmpDir, "..", "systems-cache", systemId);
  const bordbuchDir = path.join(cacheDir, "bordbuch");
  if (!existsSync(bordbuchDir)) mkdirSync(bordbuchDir, { recursive: true });
  const ndjson = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
  await fs.writeFile(path.join(bordbuchDir, "events.ndjson"), ndjson, "utf8");
}

async function readBordbuchFile(): Promise<BordbuchEntry[]> {
  const filePath = path.join(tmpDir, "..", "systems-cache", systemId, "bordbuch", "events.ndjson");
  if (!existsSync(filePath)) return [];
  const raw = await fs.readFile(filePath, "utf8");
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  return lines.map((l) => JSON.parse(l) as BordbuchEntry);
}

async function writeEntitlements(): Promise<void> {
  const cacheDir = path.join(tmpDir, "..", "systems-cache", systemId);
  const srcDir = path.join(cacheDir, "src");
  if (!existsSync(srcDir)) mkdirSync(srcDir, { recursive: true });
  const { stringify: yamlStringify } = await import("yaml");
  await fs.writeFile(
    path.join(srcDir, "entitlements.generated.yaml"),
    yamlStringify({ features: ["nachweis"] }),
    "utf8",
  );
}

async function writeEvidenceSource(
  slug: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  const cacheDir = path.join(tmpDir, "..", "systems-cache", systemId);
  const evidenceDir = path.join(
    cacheDir,
    "src",
    "content",
    "business-profile",
    "de",
    "trust",
    "evidence",
  );
  if (!existsSync(evidenceDir)) mkdirSync(evidenceDir, { recursive: true });
  const frontmatter = {
    recordId: `nr_${slug}`,
    slug,
    kind: "client-statement",
    name: `Test Evidence ${slug}`,
    items: {
      source: { sha256: "sha256:abc123", storage: "public" },
    },
    ...overrides,
  };
  const md = `---\n${Object.entries(frontmatter)
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`)
    .join("\n")}\n---\n\nTest evidence content.\n`;
  await fs.writeFile(path.join(evidenceDir, `${slug}.md`), md, "utf8");
}

async function writeSystemMd(): Promise<void> {
  const cacheDir = path.join(tmpDir, "..", "systems-cache", systemId);
  const contentDir = path.join(cacheDir, "src", "content");
  if (!existsSync(contentDir)) mkdirSync(contentDir, { recursive: true });
  const systemMd = "---\ni18n:\n  default: de\n---\n\n# Test System\n";
  await fs.writeFile(path.join(contentDir, "system.md"), systemMd, "utf8");
}

let testRoot: string;

beforeEach(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nachweis-n3-test-"));
  tmpDir = path.join(testRoot, "workspace");
  await fs.mkdir(tmpDir, { recursive: true });
  await writeEntitlements();
  await writeSystemMd();
});

afterEach(async () => {
  await fs.rm(testRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// nachweis.key.ensure
// ---------------------------------------------------------------------------

test("nachweis.key.ensure generates an Ed25519 keypair and writes private + public key files", async () => {
  const keyFile = path.join(tmpDir, "test-signing.key");

  const result = await runNachweisKeyEnsure(
    makeInput({ "key-file": keyFile }),
    mockContext(tmpDir),
  );

  expect(result.exitCode).toBe(0);
  expect(result.data!.publicKeyHex).toMatch(/^[0-9a-f]{64}$/);
  expect(result.data!.keyId).toMatch(/^[0-9a-f]{64}$/);
  expect(existsSync(keyFile)).toBe(true);
  expect(existsSync(`${keyFile}.pub`)).toBe(true);

  const privKeyHex = (await fs.readFile(keyFile, "utf8")).trim();
  expect(privKeyHex).toMatch(/^[0-9a-f]{64}$/);

  const pubKeyHex = (await fs.readFile(`${keyFile}.pub`, "utf8")).trim();
  expect(pubKeyHex).toBe(result.data!.publicKeyHex);
});

test("nachweis.key.ensure refuses to overwrite existing key without --force", async () => {
  const keyFile = path.join(tmpDir, "test-signing.key");
  await fs.writeFile(keyFile, "existing", "utf8");

  await expect(
    runNachweisKeyEnsure(makeInput({ "key-file": keyFile }), mockContext(tmpDir)),
  ).rejects.toThrow("KEY_FILE_EXISTS");
});

test("nachweis.key.ensure overwrites with --force", async () => {
  const keyFile = path.join(tmpDir, "test-signing.key");
  await fs.writeFile(keyFile, "existing", "utf8");

  const result = await runNachweisKeyEnsure(
    makeInput({ "key-file": keyFile, force: true }),
    mockContext(tmpDir),
  );

  expect(result.exitCode).toBe(0);
  const privKeyHex = (await fs.readFile(keyFile, "utf8")).trim();
  expect(privKeyHex).toMatch(/^[0-9a-f]{64}$/);
});

test("ensureNachweisKey produces a valid Ed25519 keypair", async () => {
  const keyFile = path.join(tmpDir, "test-signing.key");
  const result = await ensureNachweisKey(keyFile, false);

  const privKeyHex = (await fs.readFile(keyFile, "utf8")).trim();
  const privKeyBytes = new Uint8Array(Buffer.from(privKeyHex, "hex"));
  const pubKeyBytes = await getPublicKey(privKeyBytes);
  const pubKeyHex = Buffer.from(pubKeyBytes).toString("hex");
  expect(pubKeyHex).toBe(result.publicKeyHex);
});

// ---------------------------------------------------------------------------
// nachweis.sign
// ---------------------------------------------------------------------------

test("nachweis.sign signs a record and appends nachweis-signed Bordbuch entry", async () => {
  const slug = "test-evidence";
  await writeEvidenceSource(slug);

  const keyFile = path.join(tmpDir, "test-signing.key");
  await ensureNachweisKey(keyFile, false);

  const result = await runNachweisSign(
    makeInput({ system: systemId, slug, "key-file": keyFile }),
    mockContext(tmpDir),
  );

  expect(result.exitCode).toBe(0);
  expect(result.data!.slug).toBe(slug);
  expect(result.data!.signatureHex).toMatch(/^[0-9a-f]{128}$/);
  expect(result.data!.publicKeyHex).toMatch(/^[0-9a-f]{64}$/);
  expect(result.data!.bordbuchEventId).not.toBeNull();
  expect(result.data!.idempotent).toBe(false);

  const entries = await readBordbuchFile();
  const signedEntry = entries.find((e) => e.kind === "nachweis-signed");
  expect(signedEntry).toBeDefined();
  expect(signedEntry!.metadata?.slug).toBe(slug);
  expect(signedEntry!.metadata?.signatureHex).toBe(result.data!.signatureHex);
});

test("nachweis.sign is idempotent — re-running returns the same bordbuch event", async () => {
  const slug = "test-evidence";
  await writeEvidenceSource(slug);

  const keyFile = path.join(tmpDir, "test-signing.key");
  await ensureNachweisKey(keyFile, false);

  const input = makeInput({ system: systemId, slug, "key-file": keyFile });
  const result1 = await runNachweisSign(input, mockContext(tmpDir));
  const result2 = await runNachweisSign(input, mockContext(tmpDir));

  expect(result2.data!.idempotent).toBe(true);
  expect(result2.data!.bordbuchEventId).toBe(result1.data!.bordbuchEventId);
});

test("nachweis.sign fails when key file does not exist", async () => {
  const slug = "test-evidence";
  await writeEvidenceSource(slug);

  await expect(
    runNachweisSign(
      makeInput({ system: systemId, slug, "key-file": "/nonexistent/key" }),
      mockContext(tmpDir),
    ),
  ).rejects.toThrow("KEY_NOT_FOUND");
});

test("nachweis.sign fails when evidence-source not found", async () => {
  const keyFile = path.join(tmpDir, "test-signing.key");
  await ensureNachweisKey(keyFile, false);

  await expect(
    runNachweisSign(
      makeInput({ system: systemId, slug: "nonexistent", "key-file": keyFile }),
      mockContext(tmpDir),
    ),
  ).rejects.toThrow("NOT_FOUND");
});

test("canonicalBytes is deterministic", () => {
  const payload = {
    recordId: "nr_test_20260101",
    slug: "test",
    kind: "client-statement",
    name: "Test",
    items: { a: 1, b: 2 },
  };
  const bytes1 = canonicalBytes(payload);
  const bytes2 = canonicalBytes({ ...payload, items: { b: 2, a: 1 } });
  expect(Buffer.from(bytes1).toString("hex")).toBe(Buffer.from(bytes2).toString("hex"));
});

// ---------------------------------------------------------------------------
// nachweis.timestamp
// ---------------------------------------------------------------------------

test("nachweis.timestamp fails with SIGNATURE_NOT_FOUND when no nachweis-signed entry exists", async () => {
  const slug = "test-evidence";
  await writeEvidenceSource(slug);

  await expect(
    runNachweisTimestamp(makeInput({ system: systemId, slug }), mockContext(tmpDir)),
  ).rejects.toThrow("SIGNATURE_NOT_FOUND");
});

test("nachweis.timestamp dry-run returns TSA URL without querying", async () => {
  const slug = "test-evidence";
  await writeEvidenceSource(slug);

  const keyFile = path.join(tmpDir, "test-signing.key");
  await ensureNachweisKey(keyFile, false);

  await runNachweisSign(
    makeInput({ system: systemId, slug, "key-file": keyFile }),
    mockContext(tmpDir),
  );

  const result = await runNachweisTimestamp(
    makeInput({ system: systemId, slug, "dry-run": true }),
    mockContext(tmpDir),
  );

  expect(result.exitCode).toBe(0);
  expect(result.data!.tsaUrl).toBe("https://freetsa.org/tsr");
  expect(result.data!.timestampTokenBase64).toBe("");
  expect(result.data!.idempotent).toBe(false);
});

// ---------------------------------------------------------------------------
// nachweis.verify-signature
// ---------------------------------------------------------------------------

test("nachweis.verify-signature validates a correct signature", async () => {
  const slug = "test-evidence";
  await writeEvidenceSource(slug);

  const keyFile = path.join(tmpDir, "test-signing.key");
  await ensureNachweisKey(keyFile, false);

  await runNachweisSign(
    makeInput({ system: systemId, slug, "key-file": keyFile }),
    mockContext(tmpDir),
  );

  const result = await runNachweisVerifySignature(
    makeInput({ system: systemId, slug }),
    mockContext(tmpDir),
  );

  expect(result.exitCode).toBe(0);
  expect(result.data!.signatureValid).toBe(true);
  expect(result.data!.timestampVerified).toBe(false);
  expect(result.data!.publicKeyHex).toMatch(/^[0-9a-f]{64}$/);
});

test("nachweis.verify-signature fails when no signature exists", async () => {
  const slug = "test-evidence";
  await writeEvidenceSource(slug);

  const result = await runNachweisVerifySignature(
    makeInput({ system: systemId, slug }),
    mockContext(tmpDir),
  );

  expect(result.exitCode).toBe(1);
  expect(result.data!.signatureValid).toBe(false);
  expect(result.data!.details).toContain("No nachweis-signed");
});

test("nachweis.verify-signature detects tampered evidence", async () => {
  const slug = "test-evidence";
  await writeEvidenceSource(slug);

  const keyFile = path.join(tmpDir, "test-signing.key");
  await ensureNachweisKey(keyFile, false);

  await runNachweisSign(
    makeInput({ system: systemId, slug, "key-file": keyFile }),
    mockContext(tmpDir),
  );

  // Tamper with the evidence source after signing
  await writeEvidenceSource(slug, { name: "Tampered Name" });

  const result = await runNachweisVerifySignature(
    makeInput({ system: systemId, slug }),
    mockContext(tmpDir),
  );

  expect(result.exitCode).toBe(1);
  expect(result.data!.signatureValid).toBe(false);
});

// ---------------------------------------------------------------------------
// N3 gate in nachweis.approve
// ---------------------------------------------------------------------------

test("nachweis.approve --verification-level N3 fails with N3_GATE_FAILED when signature is missing", async () => {
  const slug = "test-evidence";
  await writeEvidenceSource(slug);

  const result = await runNachweisApprove(
    makeInput({
      system: systemId,
      slug,
      "verification-level": "N3",
      "legal-content-check": "passed",
    }),
    mockContext(tmpDir),
  );

  expect(result.exitCode).toBe(1);
  expect(result.summary).toContain("N3_GATE_FAILED");
  expect(result.summary).toContain("nachweis-signed");
  expect(result.summary).toContain("nachweis-timestamped");
});

test("nachweis.approve --verification-level N3 fails when signature exists but timestamp is missing", async () => {
  const slug = "test-evidence";
  await writeEvidenceSource(slug);

  const keyFile = path.join(tmpDir, "test-signing.key");
  await ensureNachweisKey(keyFile, false);

  await runNachweisSign(
    makeInput({ system: systemId, slug, "key-file": keyFile }),
    mockContext(tmpDir),
  );

  const result = await runNachweisApprove(
    makeInput({
      system: systemId,
      slug,
      "verification-level": "N3",
      "legal-content-check": "passed",
    }),
    mockContext(tmpDir),
  );

  expect(result.exitCode).toBe(1);
  expect(result.summary).toContain("N3_GATE_FAILED");
  expect(result.summary).toContain("nachweis-timestamped");
  expect(result.summary).not.toContain("nachweis-signed");
});

test("nachweis.approve --verification-level N3 succeeds when both signature and timestamp entries exist", async () => {
  const slug = "test-evidence";
  await writeEvidenceSource(slug);

  const keyFile = path.join(tmpDir, "test-signing.key");
  await ensureNachweisKey(keyFile, false);

  await runNachweisSign(
    makeInput({ system: systemId, slug, "key-file": keyFile }),
    mockContext(tmpDir),
  );

  // Manually write a nachweis-timestamped entry
  const entries = await readBordbuchFile();
  const lastHash = entries.length > 0 ? entries[entries.length - 1].hash : null;
  const tsEntry = makeEntry(
    {
      id: `event-${String(entries.length + 1).padStart(6, "0")}`,
      kind: "nachweis-timestamped" as BordbuchEntry["kind"],
      missionId: null,
      occurredAt: new Date().toISOString(),
      summary: `Record '${slug}' timestamped via FreeTSA`,
      metadata: { slug, timestampTokenBase64: "dGVzdA==", tsaUrl: "https://freetsa.org/tsr" },
    },
    lastHash,
  );
  await writeBordbuch([...entries, tsEntry]);

  const result = await runNachweisApprove(
    makeInput({
      system: systemId,
      slug,
      "verification-level": "N3",
      "legal-content-check": "passed",
    }),
    mockContext(tmpDir),
  );

  expect(result.exitCode).toBe(0);
  expect(result.data!.verificationLevel).toBe("N3");
  expect(result.data!.bordbuchEventId).not.toBeNull();
});

test("nachweis.approve --verification-level N2 is unchanged (no N3 gate)", async () => {
  const slug = "test-evidence";
  await writeEvidenceSource(slug);

  const result = await runNachweisApprove(
    makeInput({
      system: systemId,
      slug,
      "verification-level": "N2",
      "legal-content-check": "passed",
    }),
    mockContext(tmpDir),
  );

  expect(result.exitCode).toBe(0);
  expect(result.data!.verificationLevel).toBe("N2");
});

// ---------------------------------------------------------------------------
// RFC-0871: Timestamp assurance
// ---------------------------------------------------------------------------

test("RFC-0871: nachweis.timestamp dry-run defaults to rfc3161 assurance", async () => {
  const slug = "test-evidence";
  await writeEvidenceSource(slug);

  const keyFile = path.join(tmpDir, "test-signing.key");
  await ensureNachweisKey(keyFile, false);

  await runNachweisSign(
    makeInput({ system: systemId, slug, "key-file": keyFile }),
    mockContext(tmpDir),
  );

  const result = await runNachweisTimestamp(
    makeInput({ system: systemId, slug, "dry-run": true }),
    mockContext(tmpDir),
  );

  expect(result.exitCode).toBe(0);
  expect(result.data!.timestampAssurance).toBe("rfc3161");
  expect(result.data!.qualificationEvidenceRef).toBeUndefined();
});

test("RFC-0871: nachweis.timestamp dry-run accepts eidas-qualified with qualification-evidence-ref", async () => {
  const slug = "test-evidence";
  await writeEvidenceSource(slug);

  const keyFile = path.join(tmpDir, "test-signing.key");
  await ensureNachweisKey(keyFile, false);

  await runNachweisSign(
    makeInput({ system: systemId, slug, "key-file": keyFile }),
    mockContext(tmpDir),
  );

  const evidenceRef = "https://example.eu/tl/qtsp-entry.json";
  const result = await runNachweisTimestamp(
    makeInput({
      system: systemId,
      slug,
      "dry-run": true,
      "timestamp-assurance": "eidas-qualified",
      "qualification-evidence-ref": evidenceRef,
    }),
    mockContext(tmpDir),
  );

  expect(result.exitCode).toBe(0);
  expect(result.data!.timestampAssurance).toBe("eidas-qualified");
  expect(result.data!.qualificationEvidenceRef).toBe(evidenceRef);
});

test("RFC-0871: nachweis.timestamp fails when eidas-qualified without qualification-evidence-ref", async () => {
  const slug = "test-evidence";
  await writeEvidenceSource(slug);

  const keyFile = path.join(tmpDir, "test-signing.key");
  await ensureNachweisKey(keyFile, false);

  await runNachweisSign(
    makeInput({ system: systemId, slug, "key-file": keyFile }),
    mockContext(tmpDir),
  );

  await expect(
    runNachweisTimestamp(
      makeInput({
        system: systemId,
        slug,
        "dry-run": true,
        "timestamp-assurance": "eidas-qualified",
      }),
      mockContext(tmpDir),
    ),
  ).rejects.toThrow("TIMESTAMP_QUALIFICATION_EVIDENCE_REQUIRED");
});

test("RFC-0871: nachweis.timestamp fails with invalid assurance value", async () => {
  const slug = "test-evidence";
  await writeEvidenceSource(slug);

  const keyFile = path.join(tmpDir, "test-signing.key");
  await ensureNachweisKey(keyFile, false);

  await runNachweisSign(
    makeInput({ system: systemId, slug, "key-file": keyFile }),
    mockContext(tmpDir),
  );

  await expect(
    runNachweisTimestamp(
      makeInput({
        system: systemId,
        slug,
        "dry-run": true,
        "timestamp-assurance": "invalid",
      }),
      mockContext(tmpDir),
    ),
  ).rejects.toThrow("INVALID_ASSURANCE");
});

test("RFC-0871: nachweis.verify-signature reports rfc3161 for legacy entries without timestampAssurance metadata", async () => {
  const slug = "test-evidence";
  await writeEvidenceSource(slug);

  const keyFile = path.join(tmpDir, "test-signing.key");
  await ensureNachweisKey(keyFile, false);

  await runNachweisSign(
    makeInput({ system: systemId, slug, "key-file": keyFile }),
    mockContext(tmpDir),
  );

  // Manually write a legacy nachweis-timestamped entry WITHOUT timestampAssurance
  const entries = await readBordbuchFile();
  const lastHash = entries.length > 0 ? entries[entries.length - 1].hash : null;
  const tsEntry = makeEntry(
    {
      id: `event-${String(entries.length + 1).padStart(6, "0")}`,
      kind: "nachweis-timestamped" as BordbuchEntry["kind"],
      missionId: null,
      occurredAt: new Date().toISOString(),
      summary: `Record '${slug}' timestamped via FreeTSA`,
      metadata: { slug, timestampTokenBase64: "dGVzdA==", tsaUrl: "https://freetsa.org/tsr" },
    },
    lastHash,
  );
  await writeBordbuch([...entries, tsEntry]);

  const result = await runNachweisVerifySignature(
    makeInput({ system: systemId, slug }),
    mockContext(tmpDir),
  );

  expect(result.exitCode).toBe(0);
  expect(result.data!.timestampVerified).toBe(true);
  expect(result.data!.timestampAssurance).toBe("rfc3161");
  expect(result.data!.qualificationEvidenceRef).toBeUndefined();
});

test("RFC-0871: nachweis.verify-signature reports eidas-qualified when metadata present", async () => {
  const slug = "test-evidence";
  await writeEvidenceSource(slug);

  const keyFile = path.join(tmpDir, "test-signing.key");
  await ensureNachweisKey(keyFile, false);

  await runNachweisSign(
    makeInput({ system: systemId, slug, "key-file": keyFile }),
    mockContext(tmpDir),
  );

  // Write a nachweis-timestamped entry with eidas-qualified assurance
  const entries = await readBordbuchFile();
  const lastHash = entries.length > 0 ? entries[entries.length - 1].hash : null;
  const evidenceRef = "https://example.eu/tl/qtsp-entry.json";
  const tsEntry = makeEntry(
    {
      id: `event-${String(entries.length + 1).padStart(6, "0")}`,
      kind: "nachweis-timestamped" as BordbuchEntry["kind"],
      missionId: null,
      occurredAt: new Date().toISOString(),
      summary: `Record '${slug}' timestamped via QTSP`,
      metadata: {
        slug,
        timestampTokenBase64: "dGVzdA==",
        tsaUrl: "https://qtsp.example.eu/tsr",
        timestampAssurance: "eidas-qualified",
        qualificationEvidenceRef: evidenceRef,
      },
    },
    lastHash,
  );
  await writeBordbuch([...entries, tsEntry]);

  const result = await runNachweisVerifySignature(
    makeInput({ system: systemId, slug }),
    mockContext(tmpDir),
  );

  expect(result.exitCode).toBe(0);
  expect(result.data!.timestampVerified).toBe(true);
  expect(result.data!.timestampAssurance).toBe("eidas-qualified");
  expect(result.data!.qualificationEvidenceRef).toBe(evidenceRef);
  expect(result.data!.details).toContain("eIDAS qualified timestamp");
});

test("RFC-0871: nachweis.verify-signature details mention RFC 3161 for rfc3161 assurance", async () => {
  const slug = "test-evidence";
  await writeEvidenceSource(slug);

  const keyFile = path.join(tmpDir, "test-signing.key");
  await ensureNachweisKey(keyFile, false);

  await runNachweisSign(
    makeInput({ system: systemId, slug, "key-file": keyFile }),
    mockContext(tmpDir),
  );

  // Write a nachweis-timestamped entry with rfc3161 assurance
  const entries = await readBordbuchFile();
  const lastHash = entries.length > 0 ? entries[entries.length - 1].hash : null;
  const tsEntry = makeEntry(
    {
      id: `event-${String(entries.length + 1).padStart(6, "0")}`,
      kind: "nachweis-timestamped" as BordbuchEntry["kind"],
      missionId: null,
      occurredAt: new Date().toISOString(),
      summary: `Record '${slug}' timestamped via FreeTSA`,
      metadata: {
        slug,
        timestampTokenBase64: "dGVzdA==",
        tsaUrl: "https://freetsa.org/tsr",
        timestampAssurance: "rfc3161",
      },
    },
    lastHash,
  );
  await writeBordbuch([...entries, tsEntry]);

  const result = await runNachweisVerifySignature(
    makeInput({ system: systemId, slug }),
    mockContext(tmpDir),
  );

  expect(result.exitCode).toBe(0);
  expect(result.data!.timestampAssurance).toBe("rfc3161");
  expect(result.data!.details).toContain("RFC 3161 timestamp");
});
