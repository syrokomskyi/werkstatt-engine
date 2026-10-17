/*
<MODULE_CONTRACT>
  <purpose>
    Unit tests for RFC-1279: evaluateGateV2 scopes Bordbuch-derived conditions
    (record-approved, n3-met, legal-content-check-passed) to the evaluated record's
    metadata.slug — cross-record attestation contamination is fail-closed.
  </purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1279: initial tests — foreign-approval contamination, own-slug parity, slug-less fail-closed, publish refusal, machine-field approval predicate.</item>
  <item>RFC-1279: scope nachweis gate V2 bordbuch conditions to record slug

evaluateGateV2 derived record-approved / n3-met / legal-content-check-passed
from every nachweis-record entry in the site log, so one record's approval
satisfied every other record's gate (observed: nicaragua-projekt passed
allPassed on borrowed attestation).

Scope the three predicates to entries whose metadata.slug equals the
evaluated slug; slug-less entries satisfy no condition (fail-closed).
record-approved now reads metadata.approved === true instead of summary
substring matching (decision Q-1). Scoping lives inside the shared
evaluator — nachweis.validate and nachweis.publish inherit it unchanged.

Adds nachweis-rfc-1279.test.ts regression suite (8 tests, AC-1..AC-4 +
predicate pin); sweeps RFC-0872/0888 fixtures to stamp slug + approved;
documents the contract in the engine AGENTS notes. Evidence emitted via
rfc.verification.emit; review REVIEW-CODE-2026-10-14-01 (warning, both
findings fixed).</item>
</CHANGE_SUMMARY>
*/

import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
import { evaluateGateV2, type NachweisGateInput } from "../nachweis/nachweis-io.ts";
import { runNachweisPublish } from "../nachweis/nachweis-publish.ts";
import { expectData } from "./helpers/kernel-result-helpers.ts";

// ── Helpers ─────────────────────────────────────────────────────────────────

const SHA256_A = "a".repeat(64);

/** Evidence data satisfying every non-bordbuch attestation-v1 condition. */
const SATISFYING_EVIDENCE: Record<string, unknown> = {
  kind: "certificate",
  slug: "victim-rec",
  items: { doc: { sha256: SHA256_A, storage: "public" } },
};

type BordbuchEntryInput = NachweisGateInput["bordbuchEntries"][number];

function approveEntry(
  slug: string | undefined,
  overrides?: {
    summary?: string;
    metadata?: Record<string, unknown> | null;
  },
): BordbuchEntryInput {
  return {
    kind: "nachweis-record",
    summary: overrides?.summary ?? `Record '${slug}' approved (verification: N3, legal: passed)`,
    metadata:
      overrides?.metadata === undefined
        ? {
            slug,
            verificationLevel: "N3",
            legalContentCheckPassed: true,
            approved: true,
          }
        : overrides.metadata,
  };
}

function conditionStatus(gate: ReturnType<typeof evaluateGateV2>, id: string): string | undefined {
  return gate.conditions.find((c) => c.id === id)?.status;
}

function evaluateVictim(bordbuchEntries: BordbuchEntryInput[]) {
  const input: NachweisGateInput = {
    evidenceData: SATISFYING_EVIDENCE,
    consentData: undefined,
    bordbuchEntries,
  };
  return evaluateGateV2("victim-rec", "certificate", input);
}

// ── AC-1..AC-3: slug scoping inside evaluateGateV2 ───────────────────────────

describe("RFC-1279: evaluateGateV2 slug-scoped bordbuch conditions", () => {
  it("AC-1: a foreign record's approval does not satisfy this record's conditions", () => {
    const gate = evaluateVictim([approveEntry("other-rec")]);
    expect(conditionStatus(gate, "record-approved")).toBe("fail");
    expect(conditionStatus(gate, "n3-met")).toBe("fail");
    expect(conditionStatus(gate, "legal-content-check-passed")).toBe("fail");
    expect(gate.allPassed).toBe(false);
  });

  it("AC-1: the foreign record itself still passes its own conditions", () => {
    const input: NachweisGateInput = {
      evidenceData: { ...SATISFYING_EVIDENCE, slug: "other-rec" },
      consentData: undefined,
      bordbuchEntries: [approveEntry("other-rec")],
    };
    const gate = evaluateGateV2("other-rec", "certificate", input);
    expect(conditionStatus(gate, "record-approved")).toBe("pass");
    expect(conditionStatus(gate, "n3-met")).toBe("pass");
    expect(conditionStatus(gate, "legal-content-check-passed")).toBe("pass");
    expect(gate.allPassed).toBe(true);
  });

  it("AC-2: own-slug entries evaluate identically to pre-fix behavior", () => {
    const gate = evaluateVictim([approveEntry("victim-rec")]);
    expect(conditionStatus(gate, "record-approved")).toBe("pass");
    expect(conditionStatus(gate, "n3-met")).toBe("pass");
    expect(conditionStatus(gate, "legal-content-check-passed")).toBe("pass");
    expect(gate.allPassed).toBe(true);
  });

  it("AC-3: entries without metadata.slug satisfy no condition (fail-closed)", () => {
    const slugless = approveEntry(undefined, {
      metadata: { verificationLevel: "N3", legalContentCheckPassed: true, approved: true },
    });
    const gate = evaluateVictim([slugless]);
    expect(conditionStatus(gate, "record-approved")).toBe("fail");
    expect(conditionStatus(gate, "n3-met")).toBe("fail");
    expect(conditionStatus(gate, "legal-content-check-passed")).toBe("fail");
    expect(gate.allPassed).toBe(false);
  });

  it("AC-3: null metadata is fail-closed", () => {
    const gate = evaluateVictim([{ kind: "nachweis-record", summary: "approved", metadata: null }]);
    expect(conditionStatus(gate, "record-approved")).toBe("fail");
    expect(gate.allPassed).toBe(false);
  });

  it("Q-1 pin: record-approved reads metadata.approved, not the summary text", () => {
    // Summary says "approved" but the machine field is absent → fail.
    const summaryOnly = approveEntry("victim-rec", {
      metadata: { slug: "victim-rec", verificationLevel: "N3", legalContentCheckPassed: true },
    });
    const gate = evaluateVictim([summaryOnly]);
    expect(conditionStatus(gate, "record-approved")).toBe("fail");
    // Machine field set, summary wording irrelevant → pass.
    const noProse = approveEntry("victim-rec", { summary: "attestation recorded" });
    const gate2 = evaluateVictim([noProse]);
    expect(conditionStatus(gate2, "record-approved")).toBe("pass");
  });

  it("publish/withdraw record entries never satisfy approval for their own slug", () => {
    const publishEntry: BordbuchEntryInput = {
      kind: "nachweis-record",
      summary: "Published 'victim-rec'",
      metadata: {
        slug: "victim-rec",
        verificationLevel: "N3",
        publishedAt: "2026-10-14T00:00:00Z",
      },
    };
    const gate = evaluateVictim([publishEntry]);
    expect(conditionStatus(gate, "record-approved")).toBe("fail");
    // …but a publish entry does carry verificationLevel — n3-met is legitimately satisfied.
    expect(conditionStatus(gate, "n3-met")).toBe("pass");
  });
});

// ── AC-4: publish refuses on borrowed attestation ───────────────────────────

describe("RFC-1279: nachweis.publish refuses borrowed approval", () => {
  let tmpDir: string;
  let workspaceRoot: string;
  let cachePath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rfc1279-"));
    workspaceRoot = join(tmpDir, "werkstatt");
    cachePath = join(tmpDir, "systems-cache", "test-sys");
    await mkdir(workspaceRoot, { recursive: true });
    await mkdir(join(cachePath, "src", "content"), { recursive: true });
    await writeFile(
      join(cachePath, "src", "entitlements.generated.yaml"),
      "features:\n  - nachweis\n",
    );
    await writeFile(
      join(cachePath, "src", "content", "system.md"),
      `---\napp: test-app\nversion: 1.0.0\nidentity:\n  systemStar: test\n  biome: default\ni18n:\n  default: de\n  supported:\n    de: true\n---\n`,
    );
    const evidenceDir = join(
      cachePath,
      "src",
      "content",
      "business-profile",
      "de",
      "trust",
      "evidence",
    );
    await mkdir(evidenceDir, { recursive: true });
    await writeFile(
      join(evidenceDir, "victim-rec.md"),
      `---\nkind: certificate\nslug: victim-rec\ntitleDe: "Victim"\ntitleUk: "Victim"\nitems: {"doc":{"sha256":"${SHA256_A}","storage":"public"}}\n---\n\nContent\n`,
    );
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function writeBordbuchEntry(entry: Record<string, unknown>): Promise<void> {
    const dir = join(cachePath, "bordbuch");
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, "events.ndjson");
    const existing = existsSync(filePath) ? await readFile(filePath, "utf8") : "";
    const separator = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
    await writeFile(filePath, `${existing}${separator}${JSON.stringify(entry)}\n`);
  }

  function makeContext(): KernelRuntimeContext {
    const logger = createKernelLogger();
    const { io } = createDefaultIO();
    return {
      workspaceRoot,
      logger,
      io,
      fileIntents: [],
      commandName: "nachweis.publish",
    } as unknown as KernelRuntimeContext;
  }

  function makeInput(flags: Record<string, KernelFlagValue>): KernelCommandInput {
    return { flags, argv: [] };
  }

  it("AC-4: publish fails exitCode 1 listing failed condition ids when only a foreign record is approved", async () => {
    await writeBordbuchEntry({
      schemaVersion: "1.0.0",
      id: "event-000001",
      systemId: "test-sys",
      occurredAt: "2026-10-14T00:00:00Z",
      kind: "nachweis-record",
      status: "done",
      actor: "agent",
      missionId: null,
      releaseId: null,
      summary: "Record 'other-rec' approved (verification: N3, legal: passed)",
      metadata: {
        slug: "other-rec",
        verificationLevel: "N3",
        legalContentCheckPassed: true,
        approved: true,
      },
      previousHash: null,
      hash: "sha256:fake",
    });

    const result = await runNachweisPublish(
      makeInput({ system: "test-sys", slug: "victim-rec" }),
      makeContext(),
    );

    expect(result.exitCode).toBe(1);
    expect(expectData(result).published).toBe(false);
    const gate = expectData(result).gateResult;
    expect(conditionStatus(gate, "record-approved")).toBe("fail");
    expect(conditionStatus(gate, "n3-met")).toBe("fail");
    expect(conditionStatus(gate, "legal-content-check-passed")).toBe("fail");
    expect(result.summary).toContain("record-approved");
    expect(result.summary).toContain("n3-met");
    expect(result.summary).toContain("legal-content-check-passed");
  });
});
