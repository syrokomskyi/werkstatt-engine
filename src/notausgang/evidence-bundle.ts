/*
<MODULE_CONTRACT>
<purpose>RFC-1120: evidence bundling for notausgang.export — evaluates per-source eligibility (published claim ref + public visibility + consent scopes via evaluateGateV2), downloads R2 artifacts, recomputes SHA-256 fail-closed, and emits evidence/<source-id>/ with integrity.txt.</purpose>
<non-goals>
  <item>Do not write to the cache clone or bordbuch — the export package is the only output.</item>
  <item>Do not fetch external URL-only items — they are recorded as external-reference manifest entries.</item>
  <item>Do not reimplement R2 path derivation — reuse the nachweis-io resolvers; explicit item r2Path wins.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1120: initial evidence bundling — eligibility evaluation, R2 download with injected fetcher, integrity.txt emission.</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { byteHash } from "@warpgogol/werkstatt-engine/fingerprint";
import { parseMarkdownFrontmatter } from "@warpgogol/werkstatt-shared/content";
import type { NotausgangEvidenceVerdict } from "@warpgogol/werkstatt-engine/schemas";
import {
  evaluateGateV2,
  resolvePbpEntityDir,
  resolveDefaultLang,
  resolveNachweisR2Path,
  resolveNachweisPublicR2Path,
  resolveNachweisScreenshotDisplayR2Path,
  resolveNachweisRawScreenshotR2Path,
  UnsupportedNachweisKindError,
} from "../nachweis/nachweis-io.ts";

export type EvidenceDownloadFn = (r2Path: string) => Promise<Uint8Array>;

export interface EvidenceBundleResult {
  verdicts: Record<string, NotausgangEvidenceVerdict>;
  bundledSources: number;
  bundledArtifacts: number;
}

interface LoadedEntity {
  slug: string;
  lang: string;
  data: Record<string, unknown>;
}

/** List language directories under src/content/business-profile, default lang first. */
async function listProfileLangs(siteDir: string): Promise<string[]> {
  const profileRoot = path.join(siteDir, "src", "content", "business-profile");
  if (!existsSync(profileRoot)) return [];
  const entries = await fs.readdir(profileRoot, { withFileTypes: true });
  const langs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  let defaultLang: string | null = null;
  try {
    defaultLang = await resolveDefaultLang(siteDir);
  } catch {
    defaultLang = null;
  }
  return langs.sort((a, b) => (a === defaultLang ? -1 : b === defaultLang ? 1 : 0));
}

async function loadEntities(
  siteDir: string,
  langs: string[],
  entityType: string,
): Promise<LoadedEntity[]> {
  const out: LoadedEntity[] = [];
  const seen = new Set<string>();
  for (const lang of langs) {
    const dir = resolvePbpEntityDir(siteDir, lang, entityType);
    if (!existsSync(dir)) continue;
    for (const file of await fs.readdir(dir)) {
      if (!file.endsWith(".md")) continue;
      const slug = file.slice(0, -3);
      if (seen.has(slug)) continue; // translations share identity — first (default lang) wins
      seen.add(slug);
      const raw = await fs.readFile(path.join(dir, file), "utf8");
      out.push({ slug, lang, data: parseMarkdownFrontmatter(raw).data });
    }
  }
  return out;
}

function claimReferencesSource(claimData: Record<string, unknown>, source: LoadedEntity): boolean {
  if (claimData.status !== "published") return false;
  const refs = claimData.evidenceRefs as
    Record<string, { ref?: string; expectedType?: string }> | undefined;
  if (!refs) return false;
  const sourceId = typeof source.data.id === "string" ? source.data.id : null;
  return Object.values(refs).some((r) => {
    if (typeof r?.ref !== "string") return false;
    if (r.expectedType != null && r.expectedType !== "evidence-source") return false;
    if (sourceId != null && r.ref === sourceId) return true;
    return r.ref.endsWith(`/evidence/${source.slug}`) || r.ref.endsWith(`/${source.slug}`);
  });
}

/** Consent scopes as evaluateGateV2 evaluates them: every visible display aspect must be granted. */
function consentScopesGranted(
  source: LoadedEntity,
  consentData: Record<string, unknown> | undefined,
): boolean {
  const kind = typeof source.data.kind === "string" ? source.data.kind : "external-web-sources";
  let gate: ReturnType<typeof evaluateGateV2>;
  try {
    gate = evaluateGateV2(source.slug, kind, {
      evidenceData: source.data,
      consentData,
      bordbuchEntries: [],
    });
  } catch (err) {
    // Non-Nachweis kinds have no publication policy and no consent aspects — granted trivially.
    if (err instanceof UnsupportedNachweisKindError) return true;
    throw err;
  }
  return gate.conditions
    .filter((c) => c.id === "consent-granted" || c.id === "display-consent-consistent")
    .every((c) => !c.required || c.status === "pass");
}

interface ArtifactSpec {
  itemKey: string;
  r2Path: string;
  recordedSha256: string;
}

/** Collect downloadable artifact specs for an eligible source. */
function collectArtifactSpecs(systemId: string, source: LoadedEntity): ArtifactSpec[] {
  const specs: ArtifactSpec[] = [];
  const recordId = typeof source.data.recordId === "string" ? source.data.recordId : null;
  const version = typeof source.data.version === "number" ? source.data.version : null;

  const items = source.data.items as
    | Record<
        string,
        {
          sha256?: string;
          storage?: string;
          r2Path?: string;
          url?: string;
          qualityStatus?: string;
        }
      >
    | undefined;

  for (const [itemKey, item] of Object.entries(items ?? {})) {
    if (item.qualityStatus === "rejected") continue; // rejected artifacts never ship
    if (typeof item.sha256 !== "string") continue; // URL-only items carry no integrity anchor
    const r2Path =
      typeof item.r2Path === "string" && item.r2Path.length > 0
        ? item.r2Path
        : recordId != null && version != null
          ? item.storage === "public"
            ? resolveNachweisPublicR2Path(systemId, recordId, version)
            : resolveNachweisR2Path(systemId, recordId, version)
          : null;
    if (r2Path == null) continue;
    specs.push({ itemKey, r2Path, recordedSha256: item.sha256 });
  }

  // RFC-0890/0891: website screenshot artifacts (raw + processed display variant)
  const shot = source.data.websiteScreenshot as
    | {
        sha256?: string;
        storage?: string;
        rawArtifact?: { sha256?: string; r2Key?: string; originalFilename?: string };
      }
    | undefined;
  const rawArtifact = shot?.rawArtifact;
  if (rawArtifact != null && typeof rawArtifact.sha256 === "string") {
    const recordedSha256 = rawArtifact.sha256;
    const r2Path =
      typeof rawArtifact.r2Key === "string" && rawArtifact.r2Key.length > 0
        ? rawArtifact.r2Key
        : typeof rawArtifact.originalFilename === "string"
          ? resolveNachweisRawScreenshotR2Path(systemId, source.slug, rawArtifact.originalFilename)
          : null;
    if (r2Path != null) {
      specs.push({ itemKey: "website-screenshot-raw", r2Path, recordedSha256 });
    }
  }
  if (typeof shot?.sha256 === "string" && shot.storage != null) {
    specs.push({
      itemKey: "website-screenshot-display",
      r2Path: resolveNachweisScreenshotDisplayR2Path(systemId, source.slug),
      recordedSha256: shot.sha256,
    });
  }

  return specs;
}

function hasExternalOnlyItems(source: LoadedEntity): boolean {
  const items = source.data.items as Record<string, { url?: string; sha256?: string }> | undefined;
  const values = Object.values(items ?? {});
  return values.length > 0 && values.every((i) => typeof i.url === "string" && i.sha256 == null);
}

/**
 * Bundle eligible evidence artifacts into `<stagingDir>/evidence/<source-id>/`.
 * Fail-closed: a hash mismatch or an unreachable R2 artifact aborts the export.
 */
export async function bundleEvidenceArtifacts(params: {
  siteDir: string;
  stagingDir: string;
  systemId: string;
  download: EvidenceDownloadFn;
  logger?: { info(msg: string): void; warn(msg: string): void };
}): Promise<EvidenceBundleResult> {
  const { siteDir, stagingDir, systemId, download, logger } = params;
  const evidenceRoot = path.join(stagingDir, "evidence");
  await fs.mkdir(evidenceRoot, { recursive: true }); // AC-4: emitted even when empty

  const langs = await listProfileLangs(siteDir);
  const sources = await loadEntities(siteDir, langs, "evidence-source");
  const claims = await loadEntities(siteDir, langs, "claim");
  const consents = await loadEntities(siteDir, langs, "consent");
  const consentBySlug = new Map(consents.map((c) => [c.slug, c.data]));

  const verdicts: Record<string, NotausgangEvidenceVerdict> = {};
  let bundledSources = 0;
  let bundledArtifacts = 0;

  for (const source of sources) {
    const publication = source.data.publication as { visibility?: string } | undefined;
    const referenced = claims.some((c) => claimReferencesSource(c.data, source));
    const consentData = consentBySlug.get(source.slug);

    let excludeReason: string | null = null;
    if (!referenced) excludeReason = "no-published-claims";
    else if (publication?.visibility !== "public") excludeReason = "not-public";
    else if (!consentScopesGranted(source, consentData)) excludeReason = "consent-not-granted";

    if (excludeReason != null) {
      verdicts[source.slug] = { verdict: `excluded:${excludeReason}` };
      continue;
    }

    const specs = collectArtifactSpecs(systemId, source);
    if (specs.length === 0) {
      verdicts[source.slug] = {
        verdict: hasExternalOnlyItems(source) ? "external-reference" : "excluded:no-artifacts",
      };
      continue;
    }

    const sourceDir = path.join(evidenceRoot, source.slug);
    await fs.mkdir(sourceDir, { recursive: true });
    const artifacts: NonNullable<NotausgangEvidenceVerdict["artifacts"]> = [];
    const integrityLines: string[] = [];

    for (const spec of specs) {
      let bytes: Uint8Array;
      try {
        bytes = await download(spec.r2Path);
      } catch (err) {
        throw new Error(
          `[notausgang.export] evidence artifact unreachable: source '${source.slug}' item '${spec.itemKey}' r2Path '${spec.r2Path}' — ${(err as Error).message}`,
        );
      }
      const recomputed = byteHash(bytes).replace(/^sha256:/, "");
      if (recomputed !== spec.recordedSha256) {
        throw new Error(
          `[notausgang.export] evidence integrity mismatch: source '${source.slug}' item '${spec.itemKey}' — recorded ${spec.recordedSha256}, recomputed ${recomputed}`,
        );
      }
      const filename = path.basename(spec.r2Path);
      const relPath = `${spec.itemKey}/${filename}`;
      const dest = path.join(sourceDir, relPath);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, bytes);
      integrityLines.push(`${recomputed}  ${relPath}`);
      artifacts.push({
        itemKey: spec.itemKey,
        filename,
        sha256: recomputed,
        recordedSha256: spec.recordedSha256,
        r2Path: spec.r2Path,
      });
      bundledArtifacts++;
    }

    await fs.writeFile(path.join(sourceDir, "integrity.txt"), integrityLines.join("\n") + "\n");
    verdicts[source.slug] = { verdict: "bundled", artifacts };
    bundledSources++;
    logger?.info(`  evidence: bundled ${artifacts.length} artifact(s) for '${source.slug}'`);
  }

  return { verdicts, bundledSources, bundledArtifacts };
}
