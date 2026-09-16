/*
<MODULE_CONTRACT>
<purpose>RFC-0714: nachweis.approve command handler — records human approval, verification level, and legal content check in a Bordbuch entry.</purpose>


<non-goals>
  <item>Does not read or modify the evidence-source entity — approval is recorded only in the Bordbuch audit trail.</item>
  <item>Does not validate the verification level — the operator is responsible for passing the correct level.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0714: initial nachweis.approve command handler.</item>
  <item>RFC-0715: add N3 gate — verify nachweis-signed and nachweis-timestamped Bordbuch entries exist before approving at N3.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

import { existsSync } from "node:fs";
import path from "node:path";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { appendAndCommitBordbuch } from "../bordbuch/bordbuch-commit-helper.ts";
import { readBordbuch } from "../bordbuch/bordbuch-io.ts";
import { acquireLock, releaseLock, generateOperationId } from "../werkstatt/index.ts";
import {
  isNachweisEntitled,
  makeSkipResult,
  resolveNachweisCachePath,
  resolvePbpEntityDir,
  resolveDefaultLang,
  type NachweisApproveResult,
} from "./nachweis-io.ts";

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

function flagBool(input: KernelCommandInput, key: string): boolean {
  const v = input.flags[key];
  return v === true || v === "true";
}

export async function runNachweisApprove(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<NachweisApproveResult>> {
  const { workspaceRoot, logger } = context;
  const systemId = flagString(input, "system") ?? context.site?.name;
  const slug = flagString(input, "slug");
  const verificationLevel = flagString(input, "verification-level");
  const legalContentCheckRaw = flagString(input, "legal-content-check");
  const dryRun = flagBool(input, "dry-run");

  if (!systemId) throw new Error("[nachweis.approve] --system is required");
  if (!slug) throw new Error("[nachweis.approve] --slug is required");
  if (!verificationLevel) throw new Error("[nachweis.approve] --verification-level is required");
  if (!legalContentCheckRaw)
    throw new Error("[nachweis.approve] --legal-content-check is required");

  const ALLOWED_VERIFICATION_LEVELS = ["N0", "N1", "N2", "N3"];
  if (!ALLOWED_VERIFICATION_LEVELS.includes(verificationLevel)) {
    throw new Error(
      `[nachweis.approve] INVALID_VERIFICATION_LEVEL: '${verificationLevel}' — must be one of ${ALLOWED_VERIFICATION_LEVELS.join(", ")}`,
    );
  }

  const ALLOWED_LEGAL_CHECK_VALUES = ["passed", "failed"];
  if (!ALLOWED_LEGAL_CHECK_VALUES.includes(legalContentCheckRaw)) {
    throw new Error(
      `[nachweis.approve] INVALID_LEGAL_CONTENT_CHECK: '${legalContentCheckRaw}' — must be 'passed' or 'failed'`,
    );
  }

  const legalContentCheckPassed = legalContentCheckRaw === "passed";

  const entitled = await isNachweisEntitled(workspaceRoot, systemId);
  if (!entitled) {
    return makeSkipResult(
      "nachweis.approve",
      systemId,
    ) as unknown as KernelCommandResult<NachweisApproveResult>;
  }

  const cachePath = await resolveNachweisCachePath(workspaceRoot, systemId);
  const lang = await resolveDefaultLang(cachePath);
  const evidenceDir = resolvePbpEntityDir(cachePath, lang, "evidence-source");
  const evidenceFile = path.join(evidenceDir, `${slug}.md`);

  if (!existsSync(evidenceFile)) {
    logger.warn(
      `[nachweis.approve] no evidence-source file found for slug '${slug}' — Bordbuch entry will still be written`,
    );
  }

  if (dryRun) {
    return {
      data: {
        slug,
        systemId,
        verificationLevel,
        legalContentCheckPassed,
        bordbuchEventId: null,
      },
      exitCode: 0,
      summary: `[nachweis.approve] ${systemId}: DRY RUN — would approve '${slug}' (verification: ${verificationLevel}, legal: ${legalContentCheckRaw})`,
      nextSteps: [
        {
          action: `Approve for real: pnpm exec werkstatt run nachweis.approve --site ${systemId} --slug ${slug}`,
          kind: "optional",
        },
      ],
    };
  }

  // RFC-0715: N3 gate — verify signature and timestamp artifacts exist in Bordbuch
  if (verificationLevel === "N3") {
    const bordbuchEntries = await readBordbuch(workspaceRoot, systemId);
    const hasSigned = bordbuchEntries.some(
      (e) => e.kind === "nachweis-signed" && e.metadata?.slug === slug,
    );
    const hasTimestamped = bordbuchEntries.some(
      (e) => e.kind === "nachweis-timestamped" && e.metadata?.slug === slug,
    );
    if (!hasSigned || !hasTimestamped) {
      const missing: string[] = [];
      if (!hasSigned) missing.push("nachweis-signed");
      if (!hasTimestamped) missing.push("nachweis-timestamped");
      return {
        data: {
          slug,
          systemId,
          verificationLevel,
          legalContentCheckPassed,
          bordbuchEventId: null,
        },
        exitCode: 1,
        summary: `[nachweis.approve] N3_GATE_FAILED: missing ${missing.join(", ")} Bordbuch entries for '${slug}'. Run nachweis.sign and nachweis.timestamp first.`,
        nextSteps: [
          {
            action: `Sign the nachweis: pnpm exec werkstatt run nachweis.sign --site ${systemId} --slug ${slug}`,
            kind: "required",
          },
          {
            action: `Timestamp the nachweis: pnpm exec werkstatt run nachweis.timestamp --site ${systemId} --slug ${slug}`,
            kind: "required",
          },
        ],
      };
    }
  }

  const operationId = generateOperationId();
  await acquireLock(workspaceRoot, `system:${systemId}`, operationId, "nachweis.approve", "agent");
  await acquireLock(
    workspaceRoot,
    `bordbuch:${systemId}`,
    operationId,
    "nachweis.approve",
    "agent",
  );

  let bordbuchEventId: string;
  try {
    const { entry } = await appendAndCommitBordbuch(
      workspaceRoot,
      systemId,
      "nachweis-record",
      `Record '${slug}' approved (verification: ${verificationLevel}, legal: ${legalContentCheckRaw})`,
      "agent",
      {
        writerRole: "nachweis",
        metadata: {
          slug,
          verificationLevel,
          legalContentCheckPassed,
          approved: true,
        },
      },
      `Bordbuch: nachweis-record ${systemId} ${slug}`,
    );
    bordbuchEventId = entry.id;
  } finally {
    await releaseLock(workspaceRoot, `bordbuch:${systemId}`);
    await releaseLock(workspaceRoot, `system:${systemId}`);
  }

  return {
    data: {
      slug,
      systemId,
      verificationLevel,
      legalContentCheckPassed,
      bordbuchEventId,
    },
    exitCode: 0,
    summary: `[nachweis.approve] ${systemId}: approved '${slug}' (verification: ${verificationLevel}, legal: ${legalContentCheckRaw}, bordbuch: ${bordbuchEventId})`,
    nextSteps: [
      {
        action: `Publish the nachweis: pnpm exec werkstatt run nachweis.publish --site ${systemId} --slug ${slug}`,
        kind: "optional",
      },
    ],
  };
}
