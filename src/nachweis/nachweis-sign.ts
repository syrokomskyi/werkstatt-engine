/*
<MODULE_CONTRACT>
<purpose>RFC-0715/RFC-0921: nachweis.sign command handler — signs the core evidence fields of a Nachweis record with an Ed25519 operator key via shared signing core.</purpose>


<non-goals>
  <item>Does not timestamp — that is nachweis.timestamp.</item>
  <item>Does not verify — that is nachweis.verify-signature.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0921: delegate signing to shared signing core (sign, canonicalBytes, fromHex). Remove @noble/ed25519 and stableStringify imports. Remove canonicalRecordPayload function.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
  <item>RFC-1237: resolve dry-run via context.dryRun fallback — consumeCommonFlags strips --dry-run into context.dryRun before dispatch, so a flags-only read was permanently false under werkstatt run (enforced by KERNEL-FLAG-10).</item>
  <item>RFC-1237: honor dry-run via context.dryRun across kernel commands; verification envelopes keep emit-canonical ownership</item>
  <history>RFC-0715</history>
</CHANGE_SUMMARY>
*/

import path from "node:path";
import { byteHash } from "@warpgogol/werkstatt-engine/fingerprint";
import {
  sign as signingSign,
  canonicalBytes as signingCanonicalBytes,
  fromHex,
  toHex,
  getPublicKey,
} from "@warpgogol/werkstatt-engine/signing";
import { createDefaultIO, type WorkspaceIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { parseMarkdownFrontmatter } from "@warpgogol/werkstatt-shared/content";
import { appendAndCommitBordbuch } from "../bordbuch/bordbuch-commit-helper.ts";
import { readBordbuch } from "../bordbuch/bordbuch-io.ts";
import { acquireLock, releaseLock, generateOperationId } from "../werkstatt/index.ts";
import {
  isNachweisEntitled,
  makeSkipResult,
  resolveNachweisCachePath,
  resolveDefaultLang,
  resolvePbpEntityDir,
  flagString,
  flagBool,
  type NachweisSignResult,
} from "./nachweis-n3-types.ts";

export interface NachweisRecordPayload {
  recordId: string;
  slug: string;
  kind: string;
  name: string;
  items: Record<string, unknown>;
}

export async function runNachweisSign(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<NachweisSignResult>> {
  const { workspaceRoot } = context;
  const systemId = flagString(input, "system") ?? context.site?.name;
  const slug = flagString(input, "slug");
  const keyFilePath = flagString(input, "key-file");
  const dryRun = context.dryRun === true || flagBool(input, "dry-run");

  if (!systemId) throw new Error("[nachweis.sign] --system is required");
  if (!slug) throw new Error("[nachweis.sign] --slug is required");
  if (!keyFilePath) throw new Error("[nachweis.sign] --key-file is required");

  const entitled = await isNachweisEntitled(workspaceRoot, systemId);
  if (!entitled) {
    return makeSkipResult(
      "nachweis.sign",
      systemId,
    ) as unknown as KernelCommandResult<NachweisSignResult>;
  }

  if (!(await context.io.exists(keyFilePath))) {
    throw new Error(
      `[nachweis.sign] KEY_NOT_FOUND: private key file '${keyFilePath}' does not exist. Run nachweis.key.ensure first.`,
    );
  }

  const privateKeyHex = (await context.io.readFile(keyFilePath)).trim();
  const privateKeyBytes = fromHex(privateKeyHex);

  const cachePath = await resolveNachweisCachePath(workspaceRoot, systemId);
  const lang = await resolveDefaultLang(cachePath);
  const evidenceDir = resolvePbpEntityDir(cachePath, lang, "evidence-source");
  const evidenceFile = path.join(evidenceDir, `${slug}.md`);

  if (!(await context.io.exists(evidenceFile))) {
    throw new Error(
      `[nachweis.sign] NOT_FOUND: evidence-source '${slug}' not found at ${evidenceFile}`,
    );
  }

  const rawEvidence = await context.io.readFile(evidenceFile);
  const { data: evidenceData } = parseMarkdownFrontmatter(rawEvidence);

  const payload: NachweisRecordPayload = {
    recordId: (evidenceData.recordId as string | undefined) ?? `nr_${slug}`,
    slug,
    kind: (evidenceData.kind as string | undefined) ?? "evidence",
    name: (evidenceData.name as string | undefined) ?? slug,
    items: (evidenceData.items as Record<string, unknown> | undefined) ?? {},
  };

  const canonicalBytes = signingCanonicalBytes(payload as unknown as Record<string, unknown>);
  const signatureBytes = await signingSign(
    privateKeyBytes,
    payload as unknown as Record<string, unknown>,
  );
  const signatureHex = toHex(signatureBytes);

  const publicKeyBytes = await getPublicKey(privateKeyBytes);
  const publicKeyHex = toHex(publicKeyBytes);

  // Idempotency: check for existing nachweis-signed entry
  const bordbuchEntries = await readBordbuch(workspaceRoot, systemId);
  const existingSigned = bordbuchEntries.find(
    (e) =>
      e.kind === "nachweis-signed" &&
      e.metadata?.slug === slug &&
      e.metadata?.signatureHex === signatureHex,
  );
  if (existingSigned) {
    return {
      data: {
        slug,
        systemId,
        signatureHex,
        publicKeyHex,
        bordbuchEventId: existingSigned.id,
        idempotent: true,
      },
      exitCode: 0,
      summary: `[nachweis.sign] ${systemId}: already signed '${slug}' (bordbuch: ${existingSigned.id})`,
      nextSteps: [
        {
          action: `Timestamp the nachweis: pnpm exec werkstatt run nachweis.timestamp --site ${systemId} --slug ${slug}`,
          kind: "optional",
        },
      ],
    };
  }

  if (dryRun) {
    return {
      data: {
        slug,
        systemId,
        signatureHex,
        publicKeyHex,
        bordbuchEventId: null,
        idempotent: false,
      },
      exitCode: 0,
      summary: `[nachweis.sign] ${systemId}: DRY RUN — would sign '${slug}'`,
      nextSteps: [
        {
          action: `Sign for real: pnpm exec werkstatt run nachweis.sign --site ${systemId} --slug ${slug}`,
          kind: "optional",
        },
      ],
    };
  }

  const operationId = generateOperationId();
  await acquireLock(workspaceRoot, `system:${systemId}`, operationId, "nachweis.sign", "agent");
  await acquireLock(workspaceRoot, `bordbuch:${systemId}`, operationId, "nachweis.sign", "agent");

  let bordbuchEventId: string;
  try {
    const { entry } = await appendAndCommitBordbuch(
      workspaceRoot,
      systemId,
      "nachweis-signed",
      `Record '${slug}' signed by operator`,
      "agent",
      {
        writerRole: "nachweis",
        metadata: {
          slug,
          signatureHex,
          publicKeyHex,
          payloadHash: byteHash(canonicalBytes).replace("sha256:", ""),
        },
      },
      `Bordbuch: nachweis-signed ${systemId} ${slug}`,
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
      signatureHex,
      publicKeyHex,
      bordbuchEventId,
      idempotent: false,
    },
    exitCode: 0,
    summary: `[nachweis.sign] ${systemId}: signed '${slug}' (bordbuch: ${bordbuchEventId})`,
    nextSteps: [
      {
        action: `Timestamp the nachweis: pnpm exec werkstatt run nachweis.timestamp --site ${systemId} --slug ${slug}`,
        kind: "optional",
      },
    ],
  };
}
