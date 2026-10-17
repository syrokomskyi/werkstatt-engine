/*
<MODULE_CONTRACT>
<purpose>ADR-0092: Unit tests for passport staleness helpers —
isBordbuchDriftBookkeepingOnly and dropTrailingBookkeepingEntries over real
bordbuch entries appended via appendBordbuchEntry.</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>ADR-0092: initial staleness helper tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, describe, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  BOOKKEEPING_BORDBUCH_KINDS,
  isBordbuchDriftBookkeepingOnly,
  dropTrailingBookkeepingEntries,
} from "./passport-staleness.ts";
import { appendBordbuchEntry, readBordbuch } from "../bordbuch/bordbuch-io.ts";

let tmpDir: string;
let werkstattRoot: string;
const systemId = "acme";

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "passport-staleness-"));
  werkstattRoot = join(tmpDir, "werkstatt");
  // resolveCacheClonePath resolves to a sibling of the werkstatt root —
  // inside tmpDir, so afterEach cleanup removes the whole fixture.
  mkdirSync(werkstattRoot, { recursive: true });
  mkdirSync(join(tmpDir, "systems-cache", systemId), { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

async function append(kind: "mirror-sync" | "operator-note" | "mission-open" | "handover") {
  return appendBordbuchEntry(
    werkstattRoot,
    systemId,
    kind,
    `test ${kind}`,
    "test",
    kind === "mission-open" ? { missionId: "acme-m000001" } : undefined,
  );
}

describe("ADR-0092: isBordbuchDriftBookkeepingOnly", () => {
  test("tolerates a mirror-sync appended after the recorded head", async () => {
    const head = (await append("operator-note")).hash;
    await append("mirror-sync");
    const entries = await readBordbuch(werkstattRoot, systemId);
    expect(isBordbuchDriftBookkeepingOnly(entries, head)).toBe(true);
  });

  test("tolerates multiple trailing bookkeeping entries", async () => {
    const head = (await append("operator-note")).hash;
    await append("mirror-sync");
    await append("mirror-sync");
    const entries = await readBordbuch(werkstattRoot, systemId);
    expect(isBordbuchDriftBookkeepingOnly(entries, head)).toBe(true);
  });

  test("a state-changing entry after the recorded head marks real drift", async () => {
    const head = (await append("operator-note")).hash;
    await append("mission-open");
    const entries = await readBordbuch(werkstattRoot, systemId);
    expect(
      isBordbuchDriftBookkeepingOnly(entries, head),
      "a mission-open tail is state-changing — the passport must go stale",
    ).toBe(false);
  });

  test("bookkeeping followed by a state-changing entry marks real drift", async () => {
    const head = (await append("operator-note")).hash;
    await append("mirror-sync");
    await append("mission-open");
    const entries = await readBordbuch(werkstattRoot, systemId);
    expect(isBordbuchDriftBookkeepingOnly(entries, head)).toBe(false);
  });

  test("no drift at all is not a bookkeeping-only drift (fail-safe)", async () => {
    const head = (await append("operator-note")).hash;
    const entries = await readBordbuch(werkstattRoot, systemId);
    expect(isBordbuchDriftBookkeepingOnly(entries, head)).toBe(false);
  });

  test("a null recorded head tolerates an all-bookkeeping ledger", async () => {
    await append("mirror-sync");
    await append("mirror-sync");
    const entries = await readBordbuch(werkstattRoot, systemId);
    expect(isBordbuchDriftBookkeepingOnly(entries, null)).toBe(true);
  });

  test("a null recorded head with any state-changing entry marks real drift", async () => {
    await append("mirror-sync");
    await append("operator-note");
    const entries = await readBordbuch(werkstattRoot, systemId);
    expect(isBordbuchDriftBookkeepingOnly(entries, null)).toBe(false);
  });

  test("a recorded head absent from the ledger fails safe", async () => {
    await append("mirror-sync");
    const entries = await readBordbuch(werkstattRoot, systemId);
    expect(
      isBordbuchDriftBookkeepingOnly(entries, "sha256:does-not-exist"),
      "an unresolvable recorded head can never prove bookkeeping-only drift",
    ).toBe(false);
  });
});

describe("ADR-0092: dropTrailingBookkeepingEntries", () => {
  test("strips a trailing mirror-sync run, exposing the last state-significant entry", async () => {
    await append("handover");
    await append("mirror-sync");
    const entries = await readBordbuch(werkstattRoot, systemId);
    const significant = dropTrailingBookkeepingEntries(entries);
    expect(significant).toHaveLength(1);
    expect(significant[significant.length - 1].kind).toBe("handover");
  });

  test("returns the ledger unchanged when the tail is state-significant", async () => {
    await append("mirror-sync");
    await append("handover");
    const entries = await readBordbuch(werkstattRoot, systemId);
    const significant = dropTrailingBookkeepingEntries(entries);
    expect(significant).toHaveLength(2);
    expect(significant[significant.length - 1].kind).toBe("handover");
  });

  test("an all-bookkeeping ledger reduces to empty", async () => {
    await append("mirror-sync");
    const entries = await readBordbuch(werkstattRoot, systemId);
    expect(dropTrailingBookkeepingEntries(entries)).toHaveLength(0);
  });
});

describe("ADR-0092: BOOKKEEPING_BORDBUCH_KINDS", () => {
  test("contains mirror-sync", () => {
    expect(BOOKKEEPING_BORDBUCH_KINDS.has("mirror-sync")).toBe(true);
  });
});
