/*
<MODULE_CONTRACT>
  <purpose>RFC-0724: unit tests for deprecated bordbuch kind migration — verifies readBordbuch normalizes release-published to release-ready, and validateBordbuch accepts hashes computed with the deprecated kind.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0724: initial deprecated kind migration tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { BordbuchEntry } from "@warpgogol/werkstatt-engine/schemas";
import {
  computeEntryHash,
  readBordbuch,
  validateBordbuch,
  migrateDeprecatedKind,
  DEPRECATED_KIND_MIGRATIONS,
} from "./bordbuch-io.ts";
import { bordbuchEntryKindSchema } from "@warpgogol/werkstatt-engine/schemas";

let tmpDir: string;
const systemId = "test-system";

function makeEntry(
  overrides: Partial<BordbuchEntry> & Pick<BordbuchEntry, "id" | "kind" | "occurredAt" | "summary">,
  prevHash: string | null,
): BordbuchEntry {
  const base: Omit<BordbuchEntry, "hash"> = {
    schemaVersion: "1.0.0",
    id: overrides.id,
    systemId,
    occurredAt: overrides.occurredAt,
    kind: overrides.kind,
    status: "done",
    missionId: overrides.missionId ?? null,
    releaseId: overrides.releaseId ?? null,
    actor: "agent",
    summary: overrides.summary,
    previousHash: prevHash,
    metadata: overrides.metadata,
  };
  const hash = computeEntryHash(base);
  return { ...base, hash };
}

function makeEntryWithDeprecatedKind(
  deprecatedKind: string,
  id: string,
  prevHash: string | null,
): BordbuchEntry {
  const base: Omit<BordbuchEntry, "hash"> = {
    schemaVersion: "1.0.0",
    id,
    systemId,
    occurredAt: "2026-08-06T21:32:07.472Z",
    kind: deprecatedKind as BordbuchEntry["kind"],
    status: "done",
    missionId: null,
    releaseId: null,
    actor: "agent",
    summary: "Release test-r000001 published",
    previousHash: prevHash,
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

let testRoot: string;

beforeEach(async () => {
  testRoot = mkdtempSync(path.join(os.tmpdir(), "tmp-bordbuch-migration-"));
  tmpDir = path.join(testRoot, "workspace");
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(testRoot, { recursive: true, force: true });
});

test("migrateDeprecatedKind maps release-published to release-ready", () => {
  expect(migrateDeprecatedKind("release-published")).toBe("release-ready");
});

test("migrateDeprecatedKind returns unknown kinds unchanged", () => {
  expect(migrateDeprecatedKind("mission-open")).toBe("mission-open");
  expect(migrateDeprecatedKind("unknown-kind")).toBe("unknown-kind");
});

test("DEPRECATED_KIND_MIGRATIONS contains release-published -> release-ready", () => {
  expect(DEPRECATED_KIND_MIGRATIONS["release-published"]).toBe("release-ready");
});

test("readBordbuch normalizes deprecated release-published kind", async () => {
  const e1 = makeEntry(
    {
      id: "event-000001",
      kind: "mission-open",
      missionId: "m001",
      occurredAt: "2026-08-06T10:00:00.000Z",
      summary: "Mission m001 opened",
    },
    null,
  );
  // Create entry with deprecated kind — hash computed with "release-published"
  const e2 = makeEntryWithDeprecatedKind("release-published", "event-000002", e1.hash);

  await writeBordbuch([e1, e2]);

  const entries = await readBordbuch(tmpDir, systemId);
  expect(entries).toHaveLength(2);
  expect(entries[1].kind).toBe("release-ready");
});

test("validateBordbuch accepts hash computed with deprecated kind", async () => {
  const e1 = makeEntry(
    {
      id: "event-000001",
      kind: "mission-open",
      missionId: "m001",
      occurredAt: "2026-08-06T10:00:00.000Z",
      summary: "Mission m001 opened",
    },
    null,
  );
  const e2 = makeEntry(
    {
      id: "event-000002",
      kind: "mission-close",
      missionId: "m001",
      occurredAt: "2026-08-06T11:00:00.000Z",
      summary: "Mission m001 closed",
    },
    e1.hash,
  );
  // Entry with deprecated kind — hash computed with "release-published"
  const e3 = makeEntryWithDeprecatedKind("release-published", "event-000003", e2.hash);
  // Subsequent entry chains from e3's hash (which was computed with old kind)
  const e4 = makeEntry(
    {
      id: "event-000004",
      kind: "deployment",
      occurredAt: "2026-08-06T22:00:00.000Z",
      summary: "Deployed to alt",
    },
    e3.hash,
  );

  await writeBordbuch([e1, e2, e3, e4]);

  const { violations } = await validateBordbuch(tmpDir, systemId);
  // Should have zero violations — the deprecated kind hash is accepted
  expect(violations).toHaveLength(0);
});

test("validateBordbuch still detects real hash mismatches", async () => {
  const e1 = makeEntry(
    {
      id: "event-000001",
      kind: "mission-open",
      missionId: "m001",
      occurredAt: "2026-08-06T10:00:00.000Z",
      summary: "Mission m001 opened",
    },
    null,
  );
  // Tampered entry — hash doesn't match any computation
  const tampered: BordbuchEntry = {
    ...e1,
    summary: "TAMPERED SUMMARY",
    hash: e1.hash, // stale hash from original summary
  };

  await writeBordbuch([tampered]);

  const { violations } = await validateBordbuch(tmpDir, systemId);
  expect(violations.some((v) => v.rule === "hash-mismatch")).toBe(true);
});

test("DEPRECATED_KIND_MIGRATIONS: every old kind is NOT in the current enum", () => {
  const currentKinds = new Set(bordbuchEntryKindSchema.options);
  for (const oldKind of Object.keys(DEPRECATED_KIND_MIGRATIONS)) {
    expect(currentKinds.has(oldKind as never)).toBe(false);
  }
});

test("DEPRECATED_KIND_MIGRATIONS: every migration target IS in the current enum", () => {
  const currentKinds = new Set(bordbuchEntryKindSchema.options);
  for (const newKind of Object.values(DEPRECATED_KIND_MIGRATIONS)) {
    expect(currentKinds.has(newKind)).toBe(true);
  }
});
