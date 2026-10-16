/*
<MODULE_CONTRACT>
<purpose>RFC-1307: pure planner for sternsystem.register --intake — turns a
validated werkstatt:intake/v1 envelope (plus pre-read asset bytes) into the exact
files seeded into a new Sternsystem's cache clone: system.md, the primary-locale
business-profile PBP documents, publishable assets with RFC-0220 credit
sidecars, and the system-state onboarding provenance block.</purpose>
<non-goals>
  <item>Do not read or write files, spawn processes, or read the clock — the command owns IO; this function is called twice by the determinism test.</item>
  <item>Do not compose pages, sections or prose — composition is the ON-07 composer.</item>
  <item>Do not filter or repair entities — a PBP entity that fails its canonical schema throws (DNA-103).</item>
</non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>Locale directories and i18n keys use the primary subtag (route segment); the full BCP 47 tag rides in i18n.supported.&lt;segment&gt;.tag and .hreflang (RFC-1282 mapping).</item>
  <item>Only rights states the spec makes publishable without an operator decision (cleared, generated, licensed-stock) are copied; client-supplied, claimed and unknown stay in the bundle, and mood boards are design references, never site content.</item>
  <item>Every seeded file is serialized through canonical writers (sorted keys, RFC-0493 quoting) so the same intake yields byte-identical seeds (DNA-58).</item>
  <item>The seeded system.md carries the enforce gate triple (contractTerms, provenance, publication) plus legalJurisdiction — the born-valid contract, no downstream repair.</item>
  <item>Two entities resolving to one document path fail the plan — a silent overwrite is a validator defect, never a last-write-wins.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-1307: steps 3-4 — deterministic intake seed planner and sternsystem.register --intake --biome</item>
  <item>RFC-1307: canonical org-singleton PBP paths, seeded hreflang+publication.gate, full rollback</item>
  <item>RFC-1307: record review-fix decisions in compass headers</item>
  <item>REVIEW-CODE-2026-10-16-08 N3/N4: reject duplicate locale primary segments and non-2-letter primary subtags at plan time instead of seeding born-invalid i18n; credit target.domain names business-profile — the tree the seeded asset actually lands in.</item>
  <item>RFC-1307: review-08 N1-N7 — ref-scoped rollback, pre-existing content preservation, svg resolution, explicit io</item>
  <history>RFC-1307</history>
</CHANGE_SUMMARY>
*/

import YAML from "yaml";
import { pbpSchemaById } from "@warpgogol/pbp/entities";
import type { IntakeEnvelope, IntakeAsset } from "@warpgogol/werkstatt-shared/onboarding/intake";
import {
  pbpDocumentPath,
  serializePbpDocument,
} from "@warpgogol/werkstatt-shared/onboarding/pbp-layout";
import { materialCreditSchema } from "@warpgogol/werkstatt-shared/schemas/material-credit";

/** Rights states copied into the site at birth (INTAKE-CONTRACT § rights). */
export const SEEDABLE_RIGHTS_STATES = ["cleared", "generated", "licensed-stock"] as const;

/** Asset kinds that are design references, not site content. */
export const NON_CONTENT_ASSET_KINDS = ["mood"] as const;

export interface IntakeSeedInput {
  intake: IntakeEnvelope;
  /** sha256 (`sha256:<hex>`) of the bundle's intake.json bytes. */
  intakeSha256: string;
  systemId: string;
  cosmicStar: string;
  biomeId: string;
  /** Asset id → file bytes, pre-read by the command for every seedable asset. */
  assetBytes: ReadonlyMap<string, Uint8Array>;
}

export interface IntakeSeedFile {
  /** POSIX path relative to the cache clone root. */
  path: string;
  content: string | Uint8Array;
}

export interface IntakeSeedPlan {
  files: IntakeSeedFile[];
  systemState: { onboarding: { intakeId: string; intakeSha256: string; contractSnapshot: string } };
  pbpDocuments: number;
  assets: number;
}

/** Primary subtag of a BCP 47 tag — the route segment and content directory. */
export function localeSegment(tag: string): string {
  return tag.split("-")[0]!;
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (typeof value !== "object" || value === null) return value;
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    if (record[key] !== undefined) out[key] = sortDeep(record[key]);
  }
  return out;
}

function stringifyYaml(value: unknown): string {
  return YAML.stringify(value, {
    lineWidth: 0,
    singleQuote: false,
    defaultStringType: "PLAIN",
    defaultKeyType: "PLAIN",
  });
}

/** Asset ids from the intake are `AST-NN`; site file names are lowercase. */
function assetBaseName(asset: IntakeAsset): string {
  return asset.id.toLowerCase();
}

function assetExtension(asset: IntakeAsset): string {
  const dot = asset.file.lastIndexOf(".");
  return asset.file.slice(dot + 1);
}

function materialKindFor(mediaType: string): "image" | "video" | "document" {
  if (mediaType.startsWith("image/")) return "image";
  if (mediaType.startsWith("video/")) return "video";
  return "document";
}

/** Assets copied at birth: publishable rights state and real site content. */
export function isSeedableAsset(asset: IntakeAsset): boolean {
  return (
    (SEEDABLE_RIGHTS_STATES as readonly string[]).includes(asset.rights.state) &&
    !(NON_CONTENT_ASSET_KINDS as readonly string[]).includes(asset.kind)
  );
}

function creditFor(asset: IntakeAsset, lang: string): Record<string, unknown> {
  const id = assetBaseName(asset);
  // Seeded assets land under src/content/business-profile/<lang>/assets/ — the
  // target domain must name the tree the file actually lives in (REVIEW-08 N5).
  const target = {
    kind: materialKindFor(asset.mediaType),
    id,
    domain: "business-profile",
    lang,
  };
  if (asset.rights.state === "generated") {
    const generator = asset.generator;
    return {
      id,
      target,
      sourceType: "ai-generated",
      status: "needs-review",
      aiUsage: {
        kind: "ai-generated",
        humanContribution: `Prompted and selected by the studio (concept ${generator?.conceptId ?? "unknown"}).`,
        copyrightClaimed: false,
        ...(generator?.promptSha256 ? { generationRecordRef: generator.promptSha256 } : {}),
      },
      parties: [
        {
          role: "aiModel",
          name: generator?.model ?? "unknown",
          kind: "AIModel",
          ...(generator?.generatedAt ? { generatedAt: generator.generatedAt } : {}),
        },
      ],
      license: { label: "AI-generated — no copyright claimed" },
    };
  }
  const holder = asset.rights.holder ?? "unknown";
  return {
    id,
    target,
    sourceType: asset.rights.state === "licensed-stock" ? "licensed-third-party" : "commissioned",
    status: "needs-review",
    usageBasis: {
      type: asset.rights.state === "licensed-stock" ? "license" : "express-permission",
    },
    parties: [{ role: "rightsHolder", name: holder, kind: "Organization" }],
    license: {
      label: asset.rights.licence ?? "Rights cleared for this site",
      ...(asset.rights.licenceUrl ? { url: asset.rights.licenceUrl } : {}),
    },
  };
}

function buildSystemMd(input: IntakeSeedInput, primarySegment: string): string {
  const { intake } = input;
  const supported: Record<string, Record<string, string>> = {};
  const seenSegments = new Set<string>();
  for (const locale of intake.classification.locales) {
    const segment = localeSegment(locale.tag);
    // i18n.config.validate requires ^[a-z]{2}(-[A-Z]{2})?$ keys — a 3-letter
    // primary subtag would birth a site that fails its own i18n validation.
    if (!/^[a-z]{2}$/.test(segment)) {
      throw new Error(
        `[seed-from-intake] locale '${locale.tag}' primary subtag '${segment}' is not a 2-letter i18n segment — restrict the intake tag upstream`,
      );
    }
    // Two distinct tags sharing a primary segment would silently overwrite —
    // one locale lost, the survivor claiming the wrong hreflang.
    if (seenSegments.has(segment)) {
      throw new Error(
        `[seed-from-intake] locales share primary segment '${segment}' — disambiguate the intake tags before registering`,
      );
    }
    seenSegments.add(segment);
    supported[segment] =
      segment === locale.tag
        ? { name: segment, hreflang: locale.tag }
        : { name: segment, hreflang: locale.tag, tag: locale.tag };
  }
  const identity: Record<string, string> = {
    systemStar: input.cosmicStar,
    biome: input.biomeId,
  };
  const domain = intake.classification.domain;
  if (typeof domain === "string") identity.domain = domain;
  const frontmatter = {
    app: input.systemId,
    version: "1.0.0",
    identity,
    i18n: { default: primarySegment, supported },
    legalJurisdiction: intake.classification.jurisdiction,
    publication: { gate: "enforce" },
    contractTerms: { gate: "enforce" },
    provenance: { gate: "enforce" },
  };
  return `---\n${stringifyYaml(frontmatter)}---\n`;
}

/**
 * Plan every file seeded at birth. Pure: the same input always yields the
 * same files in the same order with the same bytes.
 */
export function planSeedFromIntake(input: IntakeSeedInput): IntakeSeedPlan {
  const { intake } = input;
  const primary = intake.classification.locales.find((l) => l.role === "primary");
  if (!primary) throw new Error("[seed-from-intake] intake has no locale with role: primary");
  const primarySegment = localeSegment(primary.tag);

  const files: IntakeSeedFile[] = [
    { path: "src/content/system.md", content: buildSystemMd(input, primarySegment) },
  ];

  let pbpDocuments = 0;
  for (const entity of intake.pbp) {
    const schema = pbpSchemaById[entity.schema];
    if (!schema) {
      throw new Error(
        `[seed-from-intake] no canonical PBP schema for ${entity.schema} (${entity.id})`,
      );
    }
    const parsed = schema.parse(entity) as Record<string, unknown>;
    const rel = pbpDocumentPath(primarySegment, { type: entity.type, id: entity.id });
    files.push({
      path: `src/content/business-profile/${rel}`,
      content: serializePbpDocument(parsed),
    });
    pbpDocuments++;
  }

  let assets = 0;
  for (const asset of intake.assets.filter(isSeedableAsset)) {
    const bytes = input.assetBytes.get(asset.id);
    if (!bytes) throw new Error(`[seed-from-intake] missing bytes for seedable asset ${asset.id}`);
    const base = `src/content/business-profile/${primarySegment}/assets/${assetBaseName(asset)}`;
    files.push({ path: `${base}.${assetExtension(asset)}`, content: bytes });
    const credit = materialCreditSchema.parse(creditFor(asset, primarySegment));
    files.push({ path: `${base}.credits.yaml`, content: stringifyYaml(sortDeep(credit)) });
    assets++;
  }

  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  // Two entities or assets resolving to one file would silently overwrite —
  // fail at plan time so the defect is fixed in the intake, not masked.
  const seenPaths = new Set<string>();
  for (const file of files) {
    if (seenPaths.has(file.path)) {
      throw new Error(`[seed-from-intake] duplicate seed path ${file.path} — check entity ids`);
    }
    seenPaths.add(file.path);
  }

  return {
    files,
    systemState: {
      onboarding: {
        intakeId: intake.intakeId,
        intakeSha256: input.intakeSha256,
        contractSnapshot: intake.provenance.contractSnapshot,
      },
    },
    pbpDocuments,
    assets,
  };
}
