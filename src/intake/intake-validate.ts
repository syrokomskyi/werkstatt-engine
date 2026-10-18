/*
<MODULE_CONTRACT>

<purpose>RFC-1281/RFC-1328: onboarding.intake.validate — deterministic INTAKE-01…15
validation of a werkstatt:intake/v1 hand-over bundle (INTAKE-CONTRACT +
AMD-005). Rule order is fixed: INTAKE-01 (manifest/hash integrity) and
INTAKE-02 (envelope schema, unknown major fails closed) run first;
INTAKE-03…15 run only when both produced no errors. All file access goes
through WorkspaceIO; hashing is node:crypto sha256.</purpose>
<non-goals>
  <item>Do not vendor PBP entity shapes — INTAKE-03 delegates to pbpSchemaById (DNA-103).</item>
  <item>Do not write files — the command is read-only; the bundle is immutable on arrival.</item>
</non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>contractSnapshot is compared to the sha256 of the vendored export resolved via import.meta.resolve("@warpgogol/werkstatt-shared/onboarding/intake.schema.generated.yaml")</item>
  <item>Verbatim substring checks (INTAKE-05) run against text-typed evidence items only (text/*, application/json, message/rfc822); a binary-only source is an error,.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-1324: INTAKE-01 manifest coverage exempts the fixture-only composition/ tree (compose material, not intake payload).</item>
  <item>RFC-1328/AMD-005: INTAKE-12…15 — anchored internal-marker + assessment-vocabulary scan on published free text (name/statement/summary/description), locale-native statementByLocale coverage, WebP-only rasters, closed palette vocabulary; envelope-only fields stripped before the strict pbp parse (INTAKE-03).</item>
  <item>RFC-1281: created — validateIntakeBundle (INTAKE-01…11) + runIntakeValidate command + resolveIntakeExportSha256.</item>
  <item>RFC-1281: intake contract and onboarding.intake.validate</item>
</CHANGE_SUMMARY>
*/

import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { isAbsolute, join, relative, resolve } from "node:path";

import { pbpSchemaById } from "@warpgogol/pbp/entities";
import { biomeAxesSchema, biomePaletteSchema } from "@warpgogol/werkstatt-shared/ontology";
import {
  INTAKE_SCHEMA_ID,
  intakeEnvelopeSchema,
  type IntakeEnvelope,
} from "@warpgogol/werkstatt-shared/onboarding/intake";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-shared/kernel";
import type { WorkspaceIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";

export const INTAKE_RULE_IDS = [
  "INTAKE-01",
  "INTAKE-02",
  "INTAKE-03",
  "INTAKE-04",
  "INTAKE-05",
  "INTAKE-06",
  "INTAKE-07",
  "INTAKE-08",
  "INTAKE-09",
  "INTAKE-10",
  "INTAKE-11",
  "INTAKE-12",
  "INTAKE-13",
  "INTAKE-14",
  "INTAKE-15",
] as const;

export type IntakeRuleId = (typeof INTAKE_RULE_IDS)[number];

/**
 * AMD-005/RFC-1328: evidence-ledger id shape plus the internal-assessment
 * vocabulary (evidence-source kinds, publishability gates) in free text.
 * Anchored — bare words ("source", "gap") never match.
 */
const INTERNAL_MARKER_RE =
  /\b(?:SRC|CLM|GAP|OPD|DEF|CHK|AST)-\d+|\b(?:internal_only|client-statement|after_proof)\b/;

/** Free-text fields INTAKE-12 scans on published entities (AMD-005). */
const PBP_FREE_TEXT_FIELDS = ["name", "statement", "summary", "description"] as const;

/**
 * AMD-005/RFC-1328: `visual.palette` keys must come from the canonical biome
 * palette vocabulary (`biomePaletteSchema.shape` keys — DNA-103 single source)
 * plus `background`, which aliases into the site background upstream
 * (`biome.from-intake` INTAKE_PALETTE_ALIASES).
 */
const CLOSED_PALETTE_KEYS: ReadonlySet<string> = new Set([
  ...Object.keys(biomePaletteSchema.shape),
  "background",
]);

export interface IntakeDiagnostic {
  rule: IntakeRuleId;
  severity: "error" | "warning";
  message: string;
  /** Bundle-relative file path, or JSON pointer into intake.json. */
  path?: string;
}

export interface IntakeValidateResult {
  command: "onboarding.intake.validate";
  status: "pass" | "fail";
  bundle: string;
  intakeId: string | null;
  systemId: string | null;
  contractSnapshot: { expected: string; actual: string | null };
  diagnostics: IntakeDiagnostic[];
}

export interface IntakeValidateOptions {
  /** sha256:<64hex> of the validator's own intake.schema.generated.yaml. */
  exportSha256: string;
  /** Budget ceiling for the INTAKE-11 warning. Default 5 USD. */
  costBudgetUsd?: number;
  /** Display form of the bundle path for the result payload. */
  bundleLabel?: string;
}

const EVIDENCE_SOURCE_SCHEMA = "pbp/evidence-source@1";
const CLAIM_SCHEMA = "pbp/claim@1";
const PBP_REF_RE = /^pbp\/([a-z][a-z0-9-]*)@(\d+):(.+)$/;
const SHA256_RE = /^sha256:[0-9a-f]{64}$/;

const ASSET_MEDIA_BY_EXT: Record<string, string> = {
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
  mp4: "video/mp4",
  webm: "video/webm",
  pdf: "application/pdf",
};

function sha256Of(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

/** Resolve `pbp/<type>@<v>:<id>` (PBP ref) or a bare `<id>` to { schema, id }. */
function resolveEntityRef(ref: string): { schema: string | null; id: string } {
  const m = PBP_REF_RE.exec(ref);
  if (m) return { schema: `pbp/${m[1]}@${m[2]}`, id: m[3] };
  return { schema: null, id: ref };
}

function isTextMediaType(mediaType: string | undefined): boolean {
  return (
    !!mediaType &&
    (mediaType.startsWith("text/") ||
      mediaType === "application/json" ||
      mediaType === "message/rfc822")
  );
}

/**
 * sha256 of the vendored schema export as installed — resolved through the
 * package export map so the validator always hashes the artifact a producer
 * would vendor. Null when the file is absent (export not run / not vendored).
 */
export async function resolveIntakeExportSha256(
  io: WorkspaceIO,
): Promise<{ sha256: string; path: string } | null> {
  let url: string;
  try {
    url = import.meta
      .resolve("@warpgogol/werkstatt-shared/onboarding/intake.schema.generated.yaml");
  } catch {
    return null;
  }
  const path = fileURLToPath(url);
  if (!(await io.exists(path))) return null;
  const bytes = await io.readFileBytes(path);
  return { sha256: `sha256:${sha256Of(bytes)}`, path };
}

async function listBundleFiles(bundleDir: string, io: WorkspaceIO): Promise<string[]> {
  const entries = await io.glob("**/*", { cwd: bundleDir });
  const files: string[] = [];
  for (const rel of entries) {
    const stat = await io.stat(join(bundleDir, rel));
    if (stat.isFile) files.push(toPosix(rel));
  }
  return files.sort();
}

/**
 * Validate one intake bundle directory. Pure over `io` — no ambient fs.
 * INTAKE-03…11 run only when INTAKE-01 and INTAKE-02 produced no errors.
 */
export async function validateIntakeBundle(
  bundleDir: string,
  io: WorkspaceIO,
  options: IntakeValidateOptions,
): Promise<IntakeValidateResult> {
  const diagnostics: IntakeDiagnostic[] = [];
  const error = (rule: IntakeRuleId, message: string, path?: string): void => {
    diagnostics.push({ rule, severity: "error", message, path });
  };
  const warn = (rule: IntakeRuleId, message: string, path?: string): void => {
    diagnostics.push({ rule, severity: "warning", message, path });
  };

  const result: IntakeValidateResult = {
    command: "onboarding.intake.validate",
    status: "pass",
    bundle: options.bundleLabel ?? bundleDir,
    intakeId: null,
    systemId: null,
    contractSnapshot: { expected: options.exportSha256, actual: null },
    diagnostics,
  };

  // ---------------------------------------------------------------------
  // INTAKE-01 — MANIFEST.sha256 covers every file, hashes match, no strays
  // ---------------------------------------------------------------------
  let manifestClean = true;
  if (!(await io.exists(bundleDir))) {
    error("INTAKE-01", `bundle directory does not exist: ${bundleDir}`, bundleDir);
    manifestClean = false;
  } else {
    const manifestPath = join(bundleDir, "MANIFEST.sha256");
    if (!(await io.exists(manifestPath))) {
      error("INTAKE-01", "MANIFEST.sha256 is missing from the bundle", "MANIFEST.sha256");
      manifestClean = false;
    } else {
      const manifest = await io.readFile(manifestPath);
      const listed = new Map<string, string>();
      for (const [lineNo, rawLine] of manifest.split("\n").entries()) {
        const line = rawLine.trim();
        if (line === "") continue;
        const m = /^([0-9a-f]{64})\s+\*?(.+)$/.exec(line);
        if (!m) {
          error(
            "INTAKE-01",
            `MANIFEST.sha256 line ${lineNo + 1} is malformed: '${line}'`,
            "MANIFEST.sha256",
          );
          manifestClean = false;
          continue;
        }
        const rel = toPosix(m[2].trim());
        if (listed.has(rel)) {
          error("INTAKE-01", `MANIFEST.sha256 lists '${rel}' twice`, "MANIFEST.sha256");
          manifestClean = false;
          continue;
        }
        listed.set(rel, m[1]);
      }

      // composition/ is RFC-1324 fixture compose material, not intake payload —
      // it is exempt from manifest coverage (a real operator bundle never carries it).
      const diskFiles = (await listBundleFiles(bundleDir, io)).filter(
        (f) => f !== "MANIFEST.sha256" && !f.startsWith("composition/"),
      );
      const diskSet = new Set(diskFiles);

      for (const [rel, expectedSha] of listed) {
        if (!diskSet.has(rel)) {
          error("INTAKE-01", `MANIFEST.sha256 lists '${rel}' but the file is absent`, rel);
          manifestClean = false;
          continue;
        }
        const actual = sha256Of(await io.readFileBytes(join(bundleDir, rel)));
        if (actual !== expectedSha) {
          error(
            "INTAKE-01",
            `hash mismatch for '${rel}': manifest ${expectedSha}, actual ${actual}`,
            rel,
          );
          manifestClean = false;
        }
      }
      for (const rel of diskFiles) {
        if (!listed.has(rel)) {
          error("INTAKE-01", `file '${rel}' is not listed in MANIFEST.sha256`, rel);
          manifestClean = false;
        }
      }
    }
  }

  // ---------------------------------------------------------------------
  // INTAKE-02 — intake.json parses and validates against werkstatt:intake/v1;
  // an unknown schema major fails closed with a single diagnostic
  // ---------------------------------------------------------------------
  let envelope: IntakeEnvelope | null = null;
  try {
    const raw = await io.readFile(join(bundleDir, "intake.json"));
    const parsed: unknown = JSON.parse(raw);
    const schemaField =
      parsed !== null && typeof parsed === "object"
        ? (parsed as Record<string, unknown>).schema
        : undefined;
    if (
      typeof schemaField === "string" &&
      /^werkstatt:intake\/v\d+$/.test(schemaField) &&
      schemaField !== INTAKE_SCHEMA_ID
    ) {
      error(
        "INTAKE-02",
        `unsupported intake schema '${schemaField}' — validator supports '${INTAKE_SCHEMA_ID}' only (unknown major fails closed)`,
        "/schema",
      );
    } else {
      const parsed_ = intakeEnvelopeSchema.safeParse(parsed);
      if (!parsed_.success) {
        for (const issue of parsed_.error.issues) {
          error("INTAKE-02", issue.message, `/${issue.path.map((p) => String(p)).join("/")}`);
        }
      } else {
        envelope = parsed_.data;
      }
    }
  } catch (cause) {
    error(
      "INTAKE-02",
      `intake.json is missing or not valid JSON: ${(cause as Error).message}`,
      "intake.json",
    );
  }

  if (envelope !== null) {
    result.intakeId = envelope.intakeId;
    result.systemId = envelope.systemId;
    result.contractSnapshot.actual = envelope.provenance.contractSnapshot;
  }

  // ---------------------------------------------------------------------
  // INTAKE-03…11 — only when INTAKE-01 + INTAKE-02 produced no errors
  // ---------------------------------------------------------------------
  const hasErrors = (): boolean => diagnostics.some((d) => d.severity === "error");
  if (manifestClean && envelope !== null && !hasErrors()) {
    const env = envelope;

    // --- shared lookup tables ------------------------------------------
    const entitiesById = new Map<string, { index: number; entity: Record<string, unknown> }>();
    const claimIds = new Set<string>();
    const gapIds = new Set(env.gaps.map((g) => g.id));
    const assetIds = new Set(env.assets.map((a) => a.id));

    // --- INTAKE-03: canonical PBP validation -----------------------------
    for (const [i, entity] of env.pbp.entries()) {
      if (entitiesById.has(entity.id)) {
        error("INTAKE-03", `duplicate pbp entity id '${entity.id}'`, `/pbp/${i}/id`);
      }
      entitiesById.set(entity.id, { index: i, entity: entity as Record<string, unknown> });
      if (entity.schema === CLAIM_SCHEMA) claimIds.add(entity.id);

      const canonical = pbpSchemaById[entity.schema];
      if (!canonical) {
        error(
          "INTAKE-03",
          `no canonical PBP schema registered for '${entity.schema}'`,
          `/pbp/${i}/schema`,
        );
        continue;
      }
      // AMD-005: statementByLocale/localeNeutral are envelope-level fields —
      // the frozen pbp/*@1 schemas never see them (strict parse).
      const {
        statementByLocale: _statementByLocale,
        localeNeutral: _localeNeutral,
        ...canonicalEntity
      } = entity as Record<string, unknown>;
      const r = canonical.safeParse(canonicalEntity);
      if (!r.success) {
        for (const issue of r.error.issues) {
          error(
            "INTAKE-03",
            `entity '${entity.id}': ${issue.message}`,
            `/pbp/${i}${issue.path.length > 0 ? `/${issue.path.map((p) => String(p)).join("/")}` : ""}`,
          );
        }
      }
    }

    const checkPbpRef = (ref: string, path: string): void => {
      const { id } = resolveEntityRef(ref);
      if (!entitiesById.has(id)) {
        error("INTAKE-04", `unresolved pbp entity ref '${ref}'`, path);
      }
    };
    const checkGapRef = (ref: string, path: string): void => {
      if (!gapIds.has(ref)) {
        error("INTAKE-04", `unresolved gap ref '${ref}'`, path);
      }
    };
    const checkEvidenceRef = (ref: string, path: string): void => {
      const { schema, id } = resolveEntityRef(ref);
      if (schema !== null && schema !== EVIDENCE_SOURCE_SCHEMA) {
        error(
          "INTAKE-04",
          `evidence ref '${ref}' points at schema '${schema}', not '${EVIDENCE_SOURCE_SCHEMA}'`,
          path,
        );
        return;
      }
      const target = entitiesById.get(id);
      if (!target) {
        error("INTAKE-04", `unresolved evidence-source ref '${ref}'`, path);
      } else if ((target.entity as { schema?: string }).schema !== EVIDENCE_SOURCE_SCHEMA) {
        error(
          "INTAKE-04",
          `ref '${ref}' resolves to '${(target.entity as { schema?: string }).schema}', not an evidence-source`,
          path,
        );
      }
    };

    // --- INTAKE-04: referential integrity ---------------------------------
    // annotation keys → pbp ids; annotation contents → gaps/evidence.
    for (const [entityId, annotation] of Object.entries(env.annotations)) {
      checkPbpRef(entityId, `/annotations/${entityId}`);
      if (annotation.gapRef) checkGapRef(annotation.gapRef, `/annotations/${entityId}/gapRef`);
      for (const [j, vb] of (annotation.verbatim ?? []).entries()) {
        checkEvidenceRef(vb.sourceRef, `/annotations/${entityId}/verbatim/${j}/sourceRef`);
      }
    }
    // gap.blocks → pbp ids; gap.evidenceRefs → evidence-source ids.
    for (const [i, gap] of env.gaps.entries()) {
      for (const [j, ref] of gap.blocks.entries()) {
        checkPbpRef(ref, `/gaps/${i}/blocks/${j}`);
      }
      for (const [j, ref] of (gap.evidenceRefs ?? []).entries()) {
        checkEvidenceRef(ref, `/gaps/${i}/evidenceRefs/${j}`);
      }
    }
    // voice sourceRefs → evidence-source; claimRefs → claim ids.
    for (const [i, item] of env.voice.verbatim.entries()) {
      checkEvidenceRef(item.sourceRef, `/voice/verbatim/${i}/sourceRef`);
      for (const [j, ref] of (item.claimRefs ?? []).entries()) {
        if (!claimIds.has(ref)) {
          error(
            "INTAKE-04",
            `unresolved claim ref '${ref}'`,
            `/voice/verbatim/${i}/claimRefs/${j}`,
          );
        }
      }
    }
    for (const [i, item] of env.voice.directives.entries()) {
      checkEvidenceRef(item.sourceRef, `/voice/directives/${i}/sourceRef`);
    }
    // classification evidenceRefs → evidence-source ids.
    for (const [i, locale] of env.classification.locales.entries()) {
      for (const [j, ref] of (locale.evidenceRefs ?? []).entries()) {
        checkEvidenceRef(ref, `/classification/locales/${i}/evidenceRefs/${j}`);
      }
    }
    for (const [i, intent] of env.classification.pageSetIntent.entries()) {
      for (const [j, ref] of intent.evidenceRefs.entries()) {
        checkEvidenceRef(ref, `/classification/pageSetIntent/${i}/evidenceRefs/${j}`);
      }
    }
    // claim evidenceRefs → evidence-source ids; asset refs → assets/gaps/evidence.
    for (const [i, entity] of env.pbp.entries()) {
      if (entity.schema !== CLAIM_SCHEMA) continue;
      const refs = (entity as { evidenceRefs?: Record<string, { ref?: string }> }).evidenceRefs;
      for (const [key, entry] of Object.entries(refs ?? {})) {
        if (entry && typeof entry.ref === "string") {
          checkEvidenceRef(entry.ref, `/pbp/${i}/evidenceRefs/${key}/ref`);
        }
      }
    }
    for (const [i, asset] of env.assets.entries()) {
      if (asset.rights.gapRef) checkGapRef(asset.rights.gapRef, `/assets/${i}/rights/gapRef`);
      if (asset.rights.evidenceRef) {
        checkEvidenceRef(asset.rights.evidenceRef, `/assets/${i}/rights/evidenceRef`);
      }
    }
    for (const [i, ref] of (env.visual.moodAssetRefs ?? []).entries()) {
      if (!assetIds.has(ref)) {
        error("INTAKE-04", `unresolved mood asset ref '${ref}'`, `/visual/moodAssetRefs/${i}`);
      }
    }
    // every evidence-source item sha256 → a sources/<sha256>.* file exists.
    for (const { entity } of entitiesById.values()) {
      if ((entity as { schema?: string }).schema !== EVIDENCE_SOURCE_SCHEMA) continue;
      const items = (
        entity as {
          items?: Record<string, { sha256?: string }>;
        }
      ).items;
      for (const [key, item] of Object.entries(items ?? {})) {
        if (!item.sha256) continue;
        const matches = await io.glob(`sources/${item.sha256}.*`, { cwd: bundleDir });
        if (matches.length === 0) {
          error(
            "INTAKE-04",
            `evidence item '${key}' of '${(entity as { id?: string }).id}' names sha256 ${item.sha256} but no sources/${item.sha256}.* exists`,
            `/pbp/${(entity as { id?: string }).id}/items/${key}/sha256`,
          );
        }
      }
    }

    // --- INTAKE-05: byte-exact verbatim quotes ----------------------------
    interface VerbatimCheck {
      text: string;
      sourceRef: string;
      path: string;
    }
    const verbatimChecks: VerbatimCheck[] = [];
    for (const [entityId, annotation] of Object.entries(env.annotations)) {
      for (const [j, vb] of (annotation.verbatim ?? []).entries()) {
        verbatimChecks.push({
          text: vb.text,
          sourceRef: vb.sourceRef,
          path: `/annotations/${entityId}/verbatim/${j}/text`,
        });
      }
    }
    for (const [i, item] of env.voice.verbatim.entries()) {
      verbatimChecks.push({
        text: item.text,
        sourceRef: item.sourceRef,
        path: `/voice/verbatim/${i}/text`,
      });
    }
    for (const [i, item] of env.voice.directives.entries()) {
      verbatimChecks.push({
        text: item.text,
        sourceRef: item.sourceRef,
        path: `/voice/directives/${i}/text`,
      });
    }

    for (const check of verbatimChecks) {
      const { id } = resolveEntityRef(check.sourceRef);
      const target = entitiesById.get(id);
      // Unresolvable/wrong-type refs are already reported by INTAKE-04.
      if (!target || (target.entity as { schema?: string }).schema !== EVIDENCE_SOURCE_SCHEMA) {
        continue;
      }
      const items = (
        target.entity as {
          items?: Record<string, { sha256?: string; mediaType?: string }>;
        }
      ).items;
      const textItems = Object.values(items ?? {}).filter(
        (item) => item.sha256 && isTextMediaType(item.mediaType),
      );
      if (textItems.length === 0) {
        error(
          "INTAKE-05",
          `source '${check.sourceRef}' has no text-typed items — verbatim text cannot be substring-checked`,
          check.path,
        );
        continue;
      }
      let sawFile = false;
      let found = false;
      for (const item of textItems) {
        for (const rel of await io.glob(`sources/${item.sha256}.*`, { cwd: bundleDir })) {
          sawFile = true;
          const content = await io.readFile(join(bundleDir, rel));
          if (content.includes(check.text)) {
            found = true;
            break;
          }
        }
        if (found) break;
      }
      if (sawFile && !found) {
        error(
          "INTAKE-05",
          `verbatim text is not a byte-exact substring of any text-typed item of '${check.sourceRef}'`,
          check.path,
        );
      }
    }

    // --- INTAKE-06: every draft pbp entity is internal or names a gap -----
    for (const [i, entity] of env.pbp.entries()) {
      if (entity.status !== "draft") continue;
      const annotation = env.annotations[entity.id];
      if (!annotation || (annotation.internal !== true && !annotation.gapRef)) {
        error(
          "INTAKE-06",
          `draft entity '${entity.id}' has no annotation with internal: true or a gapRef`,
          `/pbp/${i}`,
        );
      }
    }

    // --- INTAKE-07: locales ----------------------------------------------
    const localeTags = env.classification.locales.map((l) => l.tag);
    if (new Set(localeTags).size !== localeTags.length) {
      error("INTAKE-07", "duplicate BCP 47 locale tags", "/classification/locales");
    }
    const primaries = env.classification.locales.filter((l) => l.role === "primary");
    if (primaries.length !== 1) {
      error(
        "INTAKE-07",
        `expected exactly one primary locale, found ${primaries.length}`,
        "/classification/locales",
      );
    }
    const allowedLangs = new Set(localeTags.flatMap((tag) => [tag, tag.split("-")[0]]));
    for (const [i, entity] of env.pbp.entries()) {
      if (entity.schema !== CLAIM_SCHEMA || entity.status !== "published") continue;
      const lang = (entity as { statementLang?: string }).statementLang;
      if (lang && !allowedLangs.has(lang)) {
        error(
          "INTAKE-07",
          `published claim '${entity.id}' statementLang '${lang}' is not among classification locales`,
          `/pbp/${i}/statementLang`,
        );
      }
    }

    // --- INTAKE-08: visual axes via the live biomeAxesSchema --------------
    const axesResult = biomeAxesSchema.safeParse(env.visual.axes);
    if (!axesResult.success) {
      for (const issue of axesResult.error.issues) {
        error(
          "INTAKE-08",
          `visual.axes: ${issue.message}`,
          `/visual/axes${issue.path.length > 0 ? `/${issue.path.map((p) => String(p)).join("/")}` : ""}`,
        );
      }
    }
    for (const [i, font] of env.visual.fonts.entries()) {
      if (!font.scripts || font.scripts.length === 0) {
        error(
          "INTAKE-08",
          `font '${font.family}' declares no ISO 15924 scripts`,
          `/visual/fonts/${i}/scripts`,
        );
      }
    }

    // --- INTAKE-09: asset files -------------------------------------------
    for (const [i, asset] of env.assets.entries()) {
      const assetPath = `/assets/${i}`;
      const fileAbs = join(bundleDir, asset.file);
      if (!(await io.exists(fileAbs))) {
        error("INTAKE-09", `asset file '${asset.file}' is missing`, `${assetPath}/file`);
        continue;
      }
      const bytes = await io.readFileBytes(fileAbs);
      const actualSha = `sha256:${sha256Of(bytes)}`;
      if (actualSha !== asset.sha256) {
        error(
          "INTAKE-09",
          `asset '${asset.id}' sha256 mismatch — declared ${asset.sha256}, actual ${actualSha}`,
          `${assetPath}/sha256`,
        );
      }
      const stem = asset.file.slice("assets/".length, asset.file.lastIndexOf("."));
      if (SHA256_RE.test(asset.sha256) && asset.sha256 !== `sha256:${stem}`) {
        error(
          "INTAKE-09",
          `asset '${asset.id}' sha256 does not equal its content-addressed name '${asset.file}'`,
          `${assetPath}/file`,
        );
      }
      const ext = asset.file.slice(asset.file.lastIndexOf(".") + 1);
      const expectedMedia = ASSET_MEDIA_BY_EXT[ext];
      if (expectedMedia && asset.mediaType !== expectedMedia) {
        error(
          "INTAKE-09",
          `asset '${asset.id}' mediaType '${asset.mediaType}' does not match '.${ext}' (expected '${expectedMedia}')`,
          `${assetPath}/mediaType`,
        );
      }
      if (asset.origin === "generated" && !asset.generator) {
        error(
          "INTAKE-09",
          `asset '${asset.id}' is origin 'generated' but carries no generator provenance`,
          `${assetPath}/generator`,
        );
      }
      if (asset.rights.state === "licensed-stock" && !asset.rights.licence) {
        error(
          "INTAKE-09",
          `asset '${asset.id}' is 'licensed-stock' but declares no licence`,
          `${assetPath}/rights/licence`,
        );
      }
    }

    // --- INTAKE-10: provenance completeness --------------------------------
    if (env.provenance.contractSnapshot !== options.exportSha256) {
      error(
        "INTAKE-10",
        `provenance.contractSnapshot ${env.provenance.contractSnapshot} does not match the validator's schema export ${options.exportSha256} — producer must re-vendor intake.schema.generated.yaml`,
        "/provenance/contractSnapshot",
      );
    }
    for (const [i, input] of env.provenance.inputs.entries()) {
      // z.literal(false) makes clipped:true unreachable after INTAKE-02 —
      // kept as a defensive belt for future envelope loosening.
      if ((input as { clipped?: boolean }).clipped === true) {
        error(
          "INTAKE-10",
          `provenance.inputs[${i}] '${input.path}' was clipped (P1 forbids)`,
          `/provenance/inputs/${i}/clipped`,
        );
      }
    }
    if (env.provenance.quoteCheck.result !== "pass") {
      error(
        "INTAKE-10",
        `provenance.quoteCheck.result is '${env.provenance.quoteCheck.result}', expected 'pass'`,
        "/provenance/quoteCheck/result",
      );
    }

    // --- INTAKE-11: cost report — warnings only, never blocks --------------
    if (!(await io.exists(join(bundleDir, "cost-report.json")))) {
      warn("INTAKE-11", "cost-report.json is missing from the bundle", "cost-report.json");
    }
    const budget = options.costBudgetUsd ?? 5;
    if (env.provenance.cost.total > budget) {
      warn(
        "INTAKE-11",
        `provenance.cost.total $${env.provenance.cost.total} exceeds budget $${budget}`,
        "/provenance/cost/total",
      );
    }

    // --- INTAKE-12: public-safe free text on published entities (AMD-005) --
    // Anchored on the evidence-ledger id shape — bare words never match.
    for (const [i, entity] of env.pbp.entries()) {
      if (entity.status !== "published") continue;
      for (const field of PBP_FREE_TEXT_FIELDS) {
        const value = (entity as Record<string, unknown>)[field];
        if (typeof value === "string" && INTERNAL_MARKER_RE.test(value)) {
          error(
            "INTAKE-12",
            `published entity '${entity.id}' ${field} contains an internal marker`,
            `/pbp/${i}/${field}`,
          );
        }
      }
    }

    // --- INTAKE-13: locale-native statements (AMD-005) ---------------------
    // The root statement field is the primary-locale value; statementByLocale
    // must cover the rest, unless the statement is locale-neutral.
    const nonPrimaryLocaleTags = env.classification.locales
      .filter((l) => l.role !== "primary")
      .map((l) => l.tag);
    for (const [i, entity] of env.pbp.entries()) {
      if (entity.status !== "published" || entity.localeNeutral === true) continue;
      const e = entity as Record<string, unknown>;
      const carriesStatement =
        typeof e["statement"] === "string" || typeof e["summary"] === "string";
      if (!carriesStatement) continue;
      const byLocale = (e["statementByLocale"] ?? {}) as Record<string, unknown>;
      for (const tag of nonPrimaryLocaleTags) {
        if (typeof byLocale[tag] !== "string" || byLocale[tag] === "") {
          error(
            "INTAKE-13",
            `published entity '${entity.id}' has no statementByLocale value for site locale '${tag}' — localise the statement or mark localeNeutral`,
            `/pbp/${i}/statementByLocale`,
          );
        }
      }
    }

    // --- INTAKE-14: raster assets are WebP (AMD-005) -----------------------
    for (const [i, asset] of env.assets.entries()) {
      if (
        asset.mediaType.startsWith("image/") &&
        asset.mediaType !== "image/webp" &&
        asset.mediaType !== "image/svg+xml"
      ) {
        error(
          "INTAKE-14",
          `asset '${asset.id}' mediaType '${asset.mediaType}' is a raster type — the platform serves image/webp only`,
          `/assets/${i}/mediaType`,
        );
      }
    }

    // --- INTAKE-15: closed palette vocabulary (AMD-005) --------------------
    for (const key of Object.keys(env.visual.palette)) {
      if (!CLOSED_PALETTE_KEYS.has(key)) {
        error(
          "INTAKE-15",
          `visual.palette key '${key}' is outside the closed biome vocabulary — map it to a canonical key before emitting`,
          `/visual/palette/${key}`,
        );
      }
    }
  }

  result.status = diagnostics.some((d) => d.severity === "error") ? "fail" : "pass";
  return result;
}

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------

function flagString(input: KernelCommandInput, name: string): string | undefined {
  const v = input.flags[name];
  return typeof v === "string" ? v : undefined;
}

export async function runIntakeValidate(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<IntakeValidateResult>> {
  const id = flagString(input, "id");
  const bundle = flagString(input, "bundle");
  if ((id === undefined) === (bundle === undefined)) {
    return {
      exitCode: 2,
      summary: "[intake.validate] requires exactly one of --id <onboarding-id> or --bundle <dir>",
    };
  }
  const budgetRaw = flagString(input, "cost-budget-usd");
  const costBudgetUsd = budgetRaw === undefined ? 5 : Number(budgetRaw);
  if (!Number.isFinite(costBudgetUsd) || costBudgetUsd < 0) {
    return {
      exitCode: 2,
      summary: `[intake.validate] --cost-budget-usd must be a non-negative number (got '${budgetRaw}')`,
    };
  }

  const bundleDir =
    bundle !== undefined
      ? isAbsolute(bundle)
        ? bundle
        : resolve(context.workspaceRoot, bundle)
      : join(context.workspaceRoot, "onboarding", id as string, ".input", "intake");

  const rel = relative(context.workspaceRoot, bundleDir);
  const bundleLabel = rel === "" || (!rel.startsWith("..") && !isAbsolute(rel)) ? rel : bundleDir;

  const exportInfo = await resolveIntakeExportSha256(context.io);
  if (exportInfo === null) {
    const result: IntakeValidateResult = {
      command: "onboarding.intake.validate",
      status: "fail",
      bundle: bundleLabel,
      intakeId: null,
      systemId: null,
      contractSnapshot: { expected: "<missing>", actual: null },
      diagnostics: [
        {
          rule: "INTAKE-10",
          severity: "error",
          message:
            "intake.schema.generated.yaml is absent from the installed @warpgogol/werkstatt-shared package — run `onboarding.intake.schema.export` first",
        },
      ],
    };
    return {
      data: result,
      exitCode: 1,
      summary:
        "[intake.validate] schema export missing — run onboarding.intake.schema.export first",
      nextSteps: [
        {
          action:
            "Run onboarding.intake.schema.export to regenerate intake.schema.generated.yaml, then re-run this validation.",
          kind: "required",
        },
      ],
    };
  }

  const result = await validateIntakeBundle(bundleDir, context.io, {
    exportSha256: exportInfo.sha256,
    costBudgetUsd,
    bundleLabel,
  });
  const errors = result.diagnostics.filter((d) => d.severity === "error").length;
  const warnings = result.diagnostics.filter((d) => d.severity === "warning").length;
  return {
    data: result,
    exitCode: result.status === "pass" ? 0 : 1,
    summary: `[intake.validate] ${result.systemId ?? bundleLabel}: ${result.status} (${errors} errors, ${warnings} warnings)`,
  };
}
