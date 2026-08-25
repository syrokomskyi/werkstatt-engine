/*
<MODULE_CONTRACT>
<purpose>RFC-0707: nachweis.manifest.generate command handler — generates public/nachweise/manifest.json from published records.</purpose>
<keywords>nachweis, manifest, generate, public, published, deterministic</keywords>
<responsibilities>
  <item>Reads PBP EvidenceSource entities and filters by publication.visibility: public.</item>
  <item>Builds NachweisManifest with generatedAt: null (RFC-0602) and expiresAt: null.</item>
  <item>Writes to {cachePath}/public/nachweise/manifest.json using writeFileIfChanged.</item>
  <item>Writes empty manifest (records: []) when no published records exist.</item>
  <item>Skips silently when nachweis entitlement is not resolved.</item>
  <item>RFC-0872: include observation identity fields for technical-assessment records.</item>
  <item>RFC-0886: include display and websiteUrl fields in manifest entries for Nachweis evidence kinds.</item>
</responsibilities>
<non-goals>
  <item>Does not publish records — that is nachweis.publish.</item>
  <item>Does not validate gate conditions — that is nachweis.validate.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0707: initial nachweis.manifest.generate command handler.</item>
  <item>RFC-0871: read Bordbuch to resolve timestampAssurance per record, default rfc3161 for legacy entries.</item>
  <item>RFC-0872: add technical-assessment kind, include observation identity fields in manifest entries.</item>
  <item>RFC-0886: include display and websiteUrl fields in manifest entries.</item>
  <item>RFC-0888: append sichtpass Bordbuch entry after manifest file is written (unless --skip-bordbuch is set).</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { writeFileIfChanged } from "@warpgogol/werkstatt-engine/kernel";
import { parseMarkdownFrontmatter } from "@warpgogol/werkstatt-shared/content";
import { readBordbuch } from "../bordbuch/bordbuch-io.ts";
import { appendAndCommitBordbuch } from "../bordbuch/bordbuch-commit-helper.ts";
import { acquireLock, releaseLock, generateOperationId } from "../werkstatt/index.ts";
import {
  isNachweisEntitled,
  makeSkipResult,
  resolveNachweisCachePath,
  resolvePbpEntityDir,
  resolveDefaultLang,
  type NachweisManifest,
  type NachweisManifestEntry,
} from "./nachweis-io.ts";

const NACHWEIS_EVIDENCE_KINDS = new Set([
  "client-statement",
  "project-confirmation",
  "certificate",
  "operational-evidence",
  // RFC-0872: technical assessment evidence type
  "technical-assessment",
]);

const MANIFEST_SCHEMA_VERSION = "1.0.0";
const MANIFEST_OUTPUT_DIR = path.join("public", "nachweise");
const MANIFEST_OUTPUT_FILE = "manifest.json";

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

function flagBool(input: KernelCommandInput, key: string): boolean {
  const v = input.flags[key];
  return v === true || v === "true";
}

export async function runNachweisManifestGenerate(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<NachweisManifest>> {
  const { workspaceRoot, logger } = context;
  const systemId = flagString(input, "system") ?? context.site?.name;
  if (!systemId) throw new Error("[nachweis.manifest.generate] --system is required");

  const entitled = await isNachweisEntitled(workspaceRoot, systemId);
  if (!entitled) {
    return makeSkipResult(
      "nachweis.manifest.generate",
      systemId,
    ) as unknown as KernelCommandResult<NachweisManifest>;
  }

  const cachePath = await resolveNachweisCachePath(workspaceRoot, systemId);
  const lang = await resolveDefaultLang(cachePath);

  const evidenceDir = resolvePbpEntityDir(cachePath, lang, "evidence-source");
  const records: NachweisManifestEntry[] = [];

  // RFC-0871: read Bordbuch to resolve timestampAssurance per slug
  const bordbuchEntries = await readBordbuch(workspaceRoot, systemId);
  const timestampedEntries = new Map<string, { timestampAssurance?: string }>();
  for (const e of bordbuchEntries) {
    if (e.kind === "nachweis-timestamped" && e.metadata?.slug) {
      if (!timestampedEntries.has(e.metadata.slug as string)) {
        timestampedEntries.set(e.metadata.slug as string, {
          timestampAssurance: e.metadata?.timestampAssurance as string | undefined,
        });
      }
    }
  }

  if (existsSync(evidenceDir)) {
    const entries = await fs.readdir(evidenceDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith(".md") && !entry.name.endsWith(".yaml")) continue;
      const filePath = path.join(evidenceDir, entry.name);
      const raw = await fs.readFile(filePath, "utf8");
      let data: Record<string, unknown>;
      if (entry.name.endsWith(".md")) {
        const parsed = parseMarkdownFrontmatter(raw);
        data = parsed.data;
      } else {
        try {
          data = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          continue;
        }
      }

      const kind = data.kind as string | undefined;
      if (!kind || !NACHWEIS_EVIDENCE_KINDS.has(kind)) continue;

      const publication = data.publication as Record<string, unknown> | undefined;
      if (publication?.visibility !== "public") continue;

      const slug = (data.slug as string | undefined) ?? entry.name.replace(/\.(md|yaml)$/, "");
      const items = data.items as Record<string, { sha256?: string }> | undefined;
      const firstSha = items ? Object.values(items)[0]?.sha256 : undefined;

      records.push({
        recordId: (data.recordId as string | undefined) ?? `nr_${slug}`,
        slug,
        recordType: kind,
        titleDe: (data.titleDe as string | undefined) ?? "",
        titleUk: (data.titleUk as string | undefined) ?? "",
        ...(data.titleEn ? { titleEn: data.titleEn as string } : {}),
        qualityStatus: (data.qualityStatus as string | undefined) ?? "unverified",
        sourceSha256: firstSha ?? "",
        publishedAt: (publication.publishedAt as string | null) ?? null,
        timestampAssurance:
          (timestampedEntries.get(slug)?.timestampAssurance as
            "rfc3161" | "eidas-qualified" | undefined) ?? "rfc3161",
        // RFC-0872: observation identity fields for technical assessments
        ...(kind === "technical-assessment"
          ? {
              kind,
              seriesId: (data.assessment as Record<string, unknown>)?.seriesId as
                string | undefined,
              observationId: (data.assessment as Record<string, unknown>)?.observationId as
                string | undefined,
              observedAt: (data.assessment as Record<string, unknown>)?.observedAt as
                string | undefined,
              assessmentProviderId: (
                (data.assessment as Record<string, unknown>)?.provider as Record<string, unknown>
              )?.id as string | undefined,
            }
          : {}),
        // RFC-0886: display and websiteUrl fields
        ...(data.display
          ? {
              display: data.display as {
                document: string;
                screenshot: string;
                websiteLink: string;
              },
            }
          : {}),
        ...(data.websiteUrl ? { websiteUrl: data.websiteUrl as string } : {}),
      });
    }
  }

  records.sort((a, b) => a.slug.localeCompare(b.slug));

  const manifest: NachweisManifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    generatedAt: null,
    expiresAt: null,
    records,
  };

  const outputDir = path.join(cachePath, MANIFEST_OUTPUT_DIR);
  if (!existsSync(outputDir)) {
    await fs.mkdir(outputDir, { recursive: true });
  }
  const outputPath = path.join(outputDir, MANIFEST_OUTPUT_FILE);
  const manifestJson = JSON.stringify(manifest, null, 2) + "\n";
  await writeFileIfChanged(outputPath, manifestJson);

  logger.info(
    `[nachweis.manifest.generate] wrote ${records.length} record(s) to ${MANIFEST_OUTPUT_DIR}/${MANIFEST_OUTPUT_FILE}`,
  );

  // RFC-0888/RFC-0947: Append sichtpass Bordbuch entry unless --skip-bordbuch is set.
  // RFC-0947: Deduplicate — skip append when manifest hash is unchanged from last __manifest__ entry.
  const skipBordbuch = flagBool(input, "skip-bordbuch");
  if (!skipBordbuch) {
    const manifestHash = createHash("sha256").update(manifestJson).digest("hex");

    // RFC-0947: Deduplication — check last sichtpass __manifest__ entry
    let deduplicated = false;
    try {
      const entries = await readBordbuch(workspaceRoot, systemId);
      for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i];
        if (entry.kind !== "sichtpass") continue;
        const meta = entry.metadata as Record<string, unknown> | undefined;
        if (meta?.slug !== "__manifest__") continue;
        const lastHash = typeof meta.recordHash === "string" ? meta.recordHash : null;
        if (lastHash === manifestHash) {
          deduplicated = true;
          logger.info(
            `[nachweis.manifest.generate] manifest hash unchanged (${manifestHash.slice(0, 16)}...) — skipping sichtpass Bordbuch append`,
          );
        }
        break;
      }
    } catch {
      // Bordbuch read failure is non-fatal — proceed with append
    }

    if (!deduplicated) {
      const sichtpassOperationId = generateOperationId();
      await acquireLock(
        workspaceRoot,
        `system:${systemId}`,
        sichtpassOperationId,
        "nachweis.manifest.generate",
        "agent",
      );
      await acquireLock(
        workspaceRoot,
        `bordbuch:${systemId}`,
        sichtpassOperationId,
        "nachweis.manifest.generate",
        "agent",
      );
      try {
        await appendAndCommitBordbuch(
          workspaceRoot,
          systemId,
          "sichtpass",
          `Sichtpass manifest regenerated for '${systemId}'`,
          "agent",
          {
            writerRole: "nachweis",
            metadata: {
              slug: "__manifest__",
              manifestVersion: MANIFEST_SCHEMA_VERSION,
              recordHash: manifestHash,
              signaturePresent: false,
              timestampPresent: false,
              verificationLevel: "N0",
            },
          },
          `Bordbuch: sichtpass ${systemId} manifest-regenerated`,
        );
      } finally {
        await releaseLock(workspaceRoot, `bordbuch:${systemId}`);
        await releaseLock(workspaceRoot, `system:${systemId}`);
      }
    }
  } else {
    logger.info(
      "[nachweis.manifest.generate] --skip-bordbuch set, skipping sichtpass Bordbuch entry",
    );
  }

  return {
    data: manifest,
    exitCode: 0,
    summary: `[nachweis.manifest.generate] ${systemId}: ${records.length} public record(s)`,
  };
}
