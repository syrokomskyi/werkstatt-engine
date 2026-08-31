/*
<MODULE_CONTRACT>
  <purpose>Unit tests for appendBordbuchEntry duplicate mission-close/abort guard.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Guard against duplicate mission-close/abort in appendBordbuchEntry.</item>
  <item>RFC-0994: add redactForBordbuch unit tests and integration test for redacted summary storage.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  appendBordbuchEntry,
  computeEntryHash,
  redactForBordbuch,
  containsSensitivePayload,
} from "./bordbuch-io.ts";
import type { BordbuchEntry } from "@warpgogol/werkstatt-engine/schemas";

let testRoot: string;
let tmpDir: string;
const systemId = "test-system";

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

beforeEach(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bordbuch-io-test-"));
  tmpDir = path.join(testRoot, "workspace");
  await fs.mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(testRoot, { recursive: true, force: true });
});

test("appendBordbuchEntry rejects duplicate mission-close for same missionId", async () => {
  const e1 = makeEntry(
    {
      id: "event-000001",
      kind: "mission-open",
      missionId: "m001",
      occurredAt: "2026-07-28T10:00:00.000Z",
      summary: "Mission m001 opened",
    },
    null,
  );
  const e2 = makeEntry(
    {
      id: "event-000002",
      kind: "mission-close",
      missionId: "m001",
      occurredAt: "2026-07-28T11:00:00.000Z",
      summary: "Mission m001 closed",
    },
    e1.hash,
  );
  await writeBordbuch([e1, e2]);

  await expect(
    appendBordbuchEntry(tmpDir, systemId, "mission-close", "duplicate close", "agent", {
      missionId: "m001",
      writerRole: "mission",
    }),
  ).rejects.toThrow(/mission-close already exists for mission 'm001'/);
});

test("appendBordbuchEntry rejects duplicate mission-abort for same missionId", async () => {
  const e1 = makeEntry(
    {
      id: "event-000001",
      kind: "mission-open",
      missionId: "m002",
      occurredAt: "2026-07-28T10:00:00.000Z",
      summary: "Mission m002 opened",
    },
    null,
  );
  const e2 = makeEntry(
    {
      id: "event-000002",
      kind: "mission-abort",
      missionId: "m002",
      occurredAt: "2026-07-28T11:00:00.000Z",
      summary: "Mission m002 aborted",
    },
    e1.hash,
  );
  await writeBordbuch([e1, e2]);

  await expect(
    appendBordbuchEntry(tmpDir, systemId, "mission-abort", "duplicate abort", "agent", {
      missionId: "m002",
      writerRole: "mission",
    }),
  ).rejects.toThrow(/mission-abort already exists for mission 'm002'/);
});

test("appendBordbuchEntry allows mission-close after mission-abort (different lifecycle)", async () => {
  const e1 = makeEntry(
    {
      id: "event-000001",
      kind: "mission-open",
      missionId: "m003",
      occurredAt: "2026-07-28T10:00:00.000Z",
      summary: "Mission m003 opened",
    },
    null,
  );
  await writeBordbuch([e1]);

  // mission-close when only mission-open exists should succeed
  const entry = await appendBordbuchEntry(
    tmpDir,
    systemId,
    "mission-close",
    "Mission m003 closed",
    "agent",
    { missionId: "m003", writerRole: "mission" },
  );
  expect(entry.kind).toBe("mission-close");
  expect(entry.missionId).toBe("m003");
});

test("appendBordbuchEntry allows mission-close for different missionId", async () => {
  const e1 = makeEntry(
    {
      id: "event-000001",
      kind: "mission-open",
      missionId: "m004",
      occurredAt: "2026-07-28T10:00:00.000Z",
      summary: "Mission m004 opened",
    },
    null,
  );
  const e2 = makeEntry(
    {
      id: "event-000002",
      kind: "mission-close",
      missionId: "m004",
      occurredAt: "2026-07-28T11:00:00.000Z",
      summary: "Mission m004 closed",
    },
    e1.hash,
  );
  await writeBordbuch([e1, e2]);

  // mission-close for a different mission should succeed
  const entry = await appendBordbuchEntry(
    tmpDir,
    systemId,
    "mission-close",
    "Mission m005 closed",
    "agent",
    { missionId: "m005", writerRole: "mission" },
  );
  expect(entry.kind).toBe("mission-close");
  expect(entry.missionId).toBe("m005");
});

test("appendBordbuchEntry allows non-mission-close kinds after mission-close", async () => {
  const e1 = makeEntry(
    {
      id: "event-000001",
      kind: "mission-open",
      missionId: "m006",
      occurredAt: "2026-07-28T10:00:00.000Z",
      summary: "Mission m006 opened",
    },
    null,
  );
  const e2 = makeEntry(
    {
      id: "event-000002",
      kind: "mission-close",
      missionId: "m006",
      occurredAt: "2026-07-28T11:00:00.000Z",
      summary: "Mission m006 closed",
    },
    e1.hash,
  );
  await writeBordbuch([e1, e2]);

  // sichtpass after mission-close should succeed
  const entry = await appendBordbuchEntry(
    tmpDir,
    systemId,
    "sichtpass",
    "Sichtpass manifest regenerated",
    "agent",
    { writerRole: "nachweis" },
  );
  expect(entry.kind).toBe("sichtpass");
});

// --- RFC-0994: redactForBordbuch ---

test("redactForBordbuch replaces SSH git URLs with [redacted-git-url]", () => {
  const input = "Mirror sync — git@github.com:syrokomskyi/warpgogol-com.git";
  const result = redactForBordbuch(input);
  expect(result).toBe("Mirror sync — [redacted-git-url]");
});

test("redactForBordbuch replaces HTTPS URLs with credentials", () => {
  const input = "Push to https://token@github.com/user/repo.git completed";
  const result = redactForBordbuch(input);
  expect(result).toBe("Push to [redacted-git-url] completed");
});

test("redactForBordbuch handles multiple git URLs in one string", () => {
  const input = "Sync from git@github.com:foo/bar.git to git@gitlab.com:baz/qux.git";
  const result = redactForBordbuch(input);
  expect(result).toBe("Sync from [redacted-git-url] to [redacted-git-url]");
});

test("redactForBordbuch leaves non-git text unchanged", () => {
  const input = "Mission m001 closed — all checks passed";
  expect(redactForBordbuch(input)).toBe(input);
});

test("redactForBordbuch prevents false positive sensitive payload on SSH URL", () => {
  const summary = "Mirror sync — git@github.com:syrokomskyi/warpgogol-com.git";
  const redacted = redactForBordbuch(summary);
  expect(containsSensitivePayload(redacted)).toBe(false);
});

test("redactForBordbuch still allows real secrets to be caught after redaction", () => {
  const summary = "Token abc123 set on git@github.com:user/repo.git";
  const redacted = redactForBordbuch(summary);
  expect(containsSensitivePayload(redacted)).toBe(true);
});

test("appendBordbuchEntry stores redacted summary for SSH URL", async () => {
  const entry = await appendBordbuchEntry(
    tmpDir,
    systemId,
    "mirror-sync",
    "Mirror sync — git@github.com:syrokomskyi/warpgogol-com.git",
    "agent",
    { writerRole: "sternsystem" },
  );
  expect(entry.summary).toBe("Mirror sync — [redacted-git-url]");
});
