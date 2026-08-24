/*
<MODULE_CONTRACT>
<purpose>Migrator RFC-0483: replaces all {business.*} content references with
{business-profile.*} equivalents, creates missing de/ PBP entities, populates
presentation fields from legacy business data, removes the stopgap business
collection from content.config.ts, and deletes the legacy business/ directory.</purpose>
<non-goals>
  <item>Does not modify PBP schemas — presentation fields are additive (RFC-0482).</item>
  <item>Does not create uk/ PBP entities — they already exist from RFC-0481.</item>
  <item>Does not translate de/ content — copies uk/ files as structural templates; operator edits translations.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0483: initial migrator — reference migration + stopgap collection removal.</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import path from "node:path";
import type { Migrator, SternsystemData, MigrationContext } from "./types.ts";
import { MigrationError } from "./types.ts";
import { parseFrontmatter, serializeFrontmatter } from "./yaml-utils.ts";
import { readLocalesSafe } from "./rfc-0481.ts";

export const RFC_0483_MIGRATOR_ID = "rfc-0483";

const REFERENCE_MAPPINGS: Record<string, string> = {
  "{business.legal.companyName}": "{business-profile.organization/legal-identity.legalName}",
  "{business.legal.owner.fullName}":
    "{business-profile.organization/legal-identity.responsiblePerson.name}",
  "{business.legal.owner.address.street}": "{business-profile.places/backnang.address.street}",
  "{business.legal.owner.address.streetNumber}":
    "{business-profile.places/backnang.address.streetNumber}",
  "{business.legal.owner.address.zip}": "{business-profile.places/backnang.address.postalCode}",
  "{business.legal.owner.address.city}": "{business-profile.places/backnang.address.locality}",
  "{business.contact.email}": "{business-profile.contact/general-email.value}",
  "{business.contact.supportEmail}": "{business-profile.contact/general-email.value}",
  "{business.offer.price.monthly}":
    "{business-profile.offerings/digital-foundation.presentation.price.monthly}",
  "{business.offer.price.yearly}":
    "{business-profile.offerings/digital-foundation.presentation.price.yearly}",
  "{business.offer.price.setup}":
    "{business-profile.offerings/digital-foundation.presentation.price.setup}",
  "{business.offer.price.monthlyAmount}":
    "{business-profile.offerings/digital-foundation.presentation.price.monthlyAmount}",
  "{business.offer.price.yearlyAmount}":
    "{business-profile.offerings/digital-foundation.presentation.price.yearlyAmount}",
  "{business.offer.price.setupAmount}":
    "{business-profile.offerings/digital-foundation.presentation.price.setupAmount}",
  "{business.offer.price.moduleVisibilityAmount}":
    "{business-profile.offerings/digital-foundation.presentation.price.moduleVisibilityAmount}",
  "{business.offer.price.moduleBookingAmount}":
    "{business-profile.offerings/digital-foundation.presentation.price.moduleBookingAmount}",
  "{business.offer.price.moduleTrustAmount}":
    "{business-profile.offerings/digital-foundation.presentation.price.moduleTrustAmount}",
  "{business.offer.price.moduleMultilangAmount}":
    "{business-profile.offerings/digital-foundation.presentation.price.moduleMultilangAmount}",
  "{business.offer.price.moduleAutomationAmount}":
    "{business-profile.offerings/digital-foundation.presentation.price.moduleAutomationAmount}",
  "{business.offer.guarantees.delivery.label}":
    "{business-profile.offerings/digital-foundation.presentation.guarantees.delivery.label}",
  "{business.offer.guarantees.delivery.detail}":
    "{business-profile.offerings/digital-foundation.presentation.guarantees.delivery.detail}",
  "{business.offer.guarantees.uptime.label}":
    "{business-profile.offerings/digital-foundation.presentation.guarantees.uptime.label}",
  "{business.offer.guarantees.uptime.detail}":
    "{business-profile.offerings/digital-foundation.presentation.guarantees.uptime.detail}",
  "{business.offer.guarantees.smallChanges.label}":
    "{business-profile.offerings/digital-foundation.presentation.guarantees.smallChanges.label}",
  "{business.offer.guarantees.smallChanges.detail}":
    "{business-profile.offerings/digital-foundation.presentation.guarantees.smallChanges.detail}",
  "{business.offer.guarantees.response.label}":
    "{business-profile.offerings/digital-foundation.presentation.guarantees.response.label}",
  "{business.offer.guarantees.response.detail}":
    "{business-profile.offerings/digital-foundation.presentation.guarantees.response.detail}",
  "{business.offer.guarantees.dataPackage.label}":
    "{business-profile.offerings/digital-foundation.presentation.guarantees.dataPackage.label}",
  "{business.offer.guarantees.dataPackage.detail}":
    "{business-profile.offerings/digital-foundation.presentation.guarantees.dataPackage.detail}",
  "{business.offer.capacity.display.label}":
    "{business-profile.offerings/digital-foundation.presentation.capacity.display.label}",
  "{business.offer.capacity.display.rangeLabel}":
    "{business-profile.offerings/digital-foundation.presentation.capacity.display.rangeLabel}",
  "{business.offer.capacity.display.unknownAvailabilityLabel}":
    "{business-profile.offerings/digital-foundation.presentation.capacity.display.unknownAvailabilityLabel}",
  "{business.offer.growthModules.visibility.label}":
    "{business-profile.offerings/digital-foundation.presentation.growthModules.visibility.label}",
  "{business.offer.growthModules.visibility.price}":
    "{business-profile.offerings/digital-foundation.presentation.growthModules.visibility.price}",
  "{business.offer.growthModules.booking.label}":
    "{business-profile.offerings/digital-foundation.presentation.growthModules.booking.label}",
  "{business.offer.growthModules.booking.price}":
    "{business-profile.offerings/digital-foundation.presentation.growthModules.booking.price}",
  "{business.offer.growthModules.trust.label}":
    "{business-profile.offerings/digital-foundation.presentation.growthModules.trust.label}",
  "{business.offer.growthModules.trust.price}":
    "{business-profile.offerings/digital-foundation.presentation.growthModules.trust.price}",
  "{business.offer.growthModules.multilingual.label}":
    "{business-profile.offerings/digital-foundation.presentation.growthModules.multilingual.label}",
  "{business.offer.growthModules.multilingual.price}":
    "{business-profile.offerings/digital-foundation.presentation.growthModules.multilingual.price}",
  "{business.offer.growthModules.automation.label}":
    "{business-profile.offerings/digital-foundation.presentation.growthModules.automation.label}",
  "{business.offer.growthModules.automation.price}":
    "{business-profile.offerings/digital-foundation.presentation.growthModules.automation.price}",
  "{business.offer.changePrice}":
    "{business-profile.offerings/digital-foundation.presentation.changePrice}",
  "{business.offer.hourlyRate}":
    "{business-profile.offerings/digital-foundation.presentation.hourlyRate}",
  "{business.offer.billingDay}":
    "{business-profile.offerings/digital-foundation.presentation.billingDay}",
  "{business.legal.tax.taxNumber}":
    "{business-profile.organization/legal-identity.presentation.tax.taxNumber}",
  "{business.legal.tax.vatIdOrSmallBusinessNote}":
    "{business-profile.organization/legal-identity.presentation.tax.vatIdOrSmallBusinessNote}",
  "{business.web.domains.primary}": "{business-profile.web/primary.presentation.domains.primary}",
  "{business.meta.agbEffectiveDate}":
    "{business-profile.documents/terms.presentation.dates.effectiveDate}",
  "{business.meta.agbNextReviewDate}":
    "{business-profile.documents/terms.presentation.dates.nextReviewDate}",
  "{business.meta.datenschutzCreationDate}":
    "{business-profile.documents/privacy.presentation.dates.creationDate}",
  "{business.meta.impressumLastUpdateDate}":
    "{business-profile.documents/imprint.presentation.dates.lastUpdateDate}",
  "{business.meta.barrierefreiheitCreationDate}":
    "{business-profile.documents/legal-notice.presentation.dates.creationDate}",
  "{business.meta.barrierefreiheitLastReviewDate}":
    "{business-profile.documents/legal-notice.presentation.dates.lastReviewDate}",
  "{business.meta.widerrufCreationDate}":
    "{business-profile.documents/terms.presentation.dates.widerrufCreationDate}",
  "{business.meta.widerrufFormCreationDate}":
    "{business-profile.documents/terms.presentation.dates.widerrufFormCreationDate}",
  "{business.platform-comparison.display.pageText}":
    "{business-profile/business.presentation.platformComparison.display.pageText}",
  "{business.platform-comparison.display.disclosure}":
    "{business-profile/business.presentation.platformComparison.display.disclosure}",
  "{business.services.websiteDevelopment.backupRetentionDays}":
    "{business-profile/business.presentation.services.websiteDevelopment.backupRetentionDays}",
  "{business.external-services.chatbotPlatform}":
    "{business-profile/business.presentation.externalServices.chatbotPlatform}",
};

const BUSINESS_REF_PATTERN = /\{business\.[^}]+\}/g;

async function readMarkdownFiles(dir: string, baseDir: string): Promise<string[]> {
  const results: string[] = [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await readMarkdownFiles(fullPath, baseDir);
      results.push(...nested);
    } else if (entry.name.endsWith(".md")) {
      results.push(fullPath);
    }
  }
  return results;
}

function replaceReferencesInText(text: string, ctx: MigrationContext): string {
  return text.replace(BUSINESS_REF_PATTERN, (match) => {
    if (match === "{business.offer.*}") return match;
    const replacement = REFERENCE_MAPPINGS[match];
    if (!replacement) {
      throw new MigrationError(RFC_0483_MIGRATOR_ID, "", match, "Unmapped {business.*} reference");
    }
    ctx.logger.info(`[migrator rfc-0483] replacing ${match} → ${replacement}`);
    return replacement;
  });
}

function replaceReferencesInFile(raw: string, ctx: MigrationContext): string {
  return replaceReferencesInText(raw, ctx);
}

async function migrateReferences(rootPath: string, ctx: MigrationContext): Promise<void> {
  const contentDir = path.join(rootPath, "src", "content");
  const mdFiles = await readMarkdownFiles(contentDir, contentDir);
  for (const filePath of mdFiles) {
    const raw = await fs.readFile(filePath, "utf8");
    const updated = replaceReferencesInFile(raw, ctx);
    if (updated !== raw) {
      await fs.writeFile(filePath, updated, "utf8");
      ctx.logger.info(
        `[migrator rfc-0483] migrated references in ${path.relative(rootPath, filePath)}`,
      );
    }
  }
}

async function copyPbpEntitiesFromUk(rootPath: string, ctx: MigrationContext): Promise<void> {
  const bpDir = path.join(rootPath, "src", "content", "business-profile");
  const ukDir = path.join(bpDir, "uk");
  const deDir = path.join(bpDir, "de");

  const ukEntries = await readMarkdownFiles(ukDir, ukDir);
  for (const ukFile of ukEntries) {
    const relPath = path.relative(ukDir, ukFile);
    const deFile = path.join(deDir, relPath);
    try {
      await fs.access(deFile);
    } catch {
      const content = await fs.readFile(ukFile, "utf8");
      await fs.mkdir(path.dirname(deFile), { recursive: true });
      await fs.writeFile(deFile, content, "utf8");
      ctx.logger.info(`[migrator rfc-0483] created de/${relPath} from uk/ template`);
    }
  }
}

async function populatePresentationFields(rootPath: string, ctx: MigrationContext): Promise<void> {
  const businessDir = path.join(rootPath, "src", "content", "business");
  const bpDir = path.join(rootPath, "src", "content", "business-profile");

  for (const lang of await readLocalesSafe(rootPath, ctx)) {
    const legacyDir = path.join(businessDir, lang);
    let legacyFiles: string[];
    try {
      legacyFiles = await readMarkdownFiles(legacyDir, legacyDir);
    } catch {
      continue;
    }
    if (legacyFiles.length === 0) continue;

    for (const legacyFile of legacyFiles) {
      const fileName = path.basename(legacyFile, ".md");
      const legacyRaw = await fs.readFile(legacyFile, "utf8");
      const { frontmatter } = parseFrontmatter(legacyRaw);

      const presentation = extractPresentation(fileName, frontmatter);
      if (Object.keys(presentation).length === 0) continue;

      const targetPath = resolvePresentationTarget(fileName, bpDir, lang);
      if (!targetPath) continue;

      try {
        const targetRaw = await fs.readFile(targetPath, "utf8");
        const { frontmatter: targetFm, body } = parseFrontmatter(targetRaw);
        const existingPresentation = (targetFm.presentation as Record<string, unknown>) ?? {};
        const merged = mergePresentation(existingPresentation, presentation);
        targetFm.presentation = merged;
        const updated = serializeFrontmatter(targetFm) + body;
        await fs.writeFile(targetPath, updated, "utf8");
        ctx.logger.info(
          `[migrator rfc-0483] populated presentation.* on ${path.relative(rootPath, targetPath)}`,
        );
      } catch {
        ctx.logger.info(
          `[migrator rfc-0483] target ${path.relative(rootPath, targetPath)} not found — skipping presentation for ${fileName}`,
        );
      }
    }
  }
}

function extractPresentation(
  fileName: string,
  frontmatter: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (fileName === "offer") {
    const offer = frontmatter as Record<string, unknown>;
    if (offer.price) result.price = offer.price;
    if (offer.guarantees) result.guarantees = offer.guarantees;
    if (offer.capacity) result.capacity = offer.capacity;
    if (offer.growthModules) result.growthModules = offer.growthModules;
    if (offer.changePrice) result.changePrice = offer.changePrice;
    if (offer.hourlyRate) result.hourlyRate = offer.hourlyRate;
    if (offer.billingDay) result.billingDay = offer.billingDay;
  } else if (fileName === "legal") {
    const legal = frontmatter as Record<string, unknown>;
    const tax = (legal.tax as Record<string, unknown>) ?? {};
    const presentationTax: Record<string, unknown> = {};
    if (tax.taxNumber) presentationTax.taxNumber = tax.taxNumber;
    if (tax.vatIdOrSmallBusinessNote)
      presentationTax.vatIdOrSmallBusinessNote = tax.vatIdOrSmallBusinessNote;
    if (Object.keys(presentationTax).length > 0) result.tax = presentationTax;
  } else if (fileName === "web") {
    const web = frontmatter as Record<string, unknown>;
    const domains = (web.domains as Record<string, unknown>) ?? {};
    if (Object.keys(domains).length > 0) result.domains = domains;
  } else if (fileName === "meta") {
    const meta = frontmatter as Record<string, unknown>;
    const dates: Record<string, unknown> = {};
    if (meta.agbEffectiveDate) dates.effectiveDate = meta.agbEffectiveDate;
    if (meta.agbNextReviewDate) dates.nextReviewDate = meta.agbNextReviewDate;
    if (meta.datenschutzCreationDate) dates.creationDate = meta.datenschutzCreationDate;
    if (meta.impressumLastUpdateDate) dates.lastUpdateDate = meta.impressumLastUpdateDate;
    if (meta.barrierefreiheitCreationDate) dates.creationDate = meta.barrierefreiheitCreationDate;
    if (meta.barrierefreiheitLastReviewDate)
      dates.lastReviewDate = meta.barrierefreiheitLastReviewDate;
    if (meta.widerrufCreationDate) dates.widerrufCreationDate = meta.widerrufCreationDate;
    if (meta.widerrufFormCreationDate)
      dates.widerrufFormCreationDate = meta.widerrufFormCreationDate;
    if (Object.keys(dates).length > 0) result.dates = dates;
  } else if (fileName === "external-services") {
    const ext = frontmatter as Record<string, unknown>;
    if (ext.chatbotPlatform) {
      const es: Record<string, unknown> = {};
      es.chatbotPlatform = ext.chatbotPlatform;
      result.externalServices = es;
    }
  } else if (fileName === "company") {
    const company = frontmatter as Record<string, unknown>;
    if (company.platformComparison) result.platformComparison = company.platformComparison;
    if (company.services) result.services = company.services;
  }
  return result;
}

function resolvePresentationTarget(fileName: string, bpDir: string, lang: string): string | null {
  const targets: Record<string, string> = {
    offer: path.join(bpDir, lang, "offerings", "digital-foundation.md"),
    legal: path.join(bpDir, lang, "organization", "legal-identity.md"),
    web: path.join(bpDir, lang, "web", "primary.md"),
    "external-services": path.join(bpDir, lang, "business.md"),
    company: path.join(bpDir, lang, "business.md"),
    meta: path.join(bpDir, lang, "documents", "terms.md"),
  };
  return targets[fileName] ?? null;
}

function mergePresentation(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      typeof result[key] === "object" &&
      result[key] !== null &&
      !Array.isArray(result[key])
    ) {
      result[key] = mergePresentation(
        result[key] as Record<string, unknown>,
        value as Record<string, unknown>,
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}

async function removeBusinessCollectionFromConfig(
  rootPath: string,
  ctx: MigrationContext,
): Promise<void> {
  const configPath = path.join(rootPath, "src", "content.config.ts");
  let raw: string;
  try {
    raw = await fs.readFile(configPath, "utf8");
  } catch {
    return;
  }

  let updated = raw;
  const businessCollectionPattern =
    /\/\/ Loads business entity records[\s\S]*?const business = defineCollection\(\{[\s\S]*?\}\);\n*/;
  updated = updated.replace(businessCollectionPattern, "");
  updated = updated.replace(/^\s*business,\s*$/m, "");
  updated = updated.replace(
    /import\s*\{[^}]*businessCollections[^}]*\}\s*from\s*"@warpgogol\/business\/astro";\n*/g,
    "",
  );

  if (updated !== raw) {
    await fs.writeFile(configPath, updated, "utf8");
    ctx.logger.info(`[migrator rfc-0483] removed business collection from content.config.ts`);
  }
}

async function deleteBusinessDirectory(rootPath: string, ctx: MigrationContext): Promise<void> {
  const businessDir = path.join(rootPath, "src", "content", "business");
  const contentDir = path.join(rootPath, "src", "content");
  const mdFiles = await readMarkdownFiles(contentDir, contentDir);

  for (const filePath of mdFiles) {
    const raw = await fs.readFile(filePath, "utf8");
    const matches = raw.match(BUSINESS_REF_PATTERN);
    if (matches) {
      const realRefs = matches.filter((m) => m !== "{business.offer.*}");
      if (realRefs.length > 0) {
        throw new MigrationError(
          RFC_0483_MIGRATOR_ID,
          path.relative(rootPath, filePath),
          "",
          `Cannot delete business/ — ${realRefs.length} unresolved {business.*} references remain`,
        );
      }
    }
  }

  try {
    await fs.rm(businessDir, { recursive: true, force: true });
    ctx.logger.info(`[migrator rfc-0483] deleted src/content/business/ directory`);
  } catch {
    ctx.logger.info(`[migrator rfc-0483] business/ directory already absent`);
  }
}

const OLD_FORMAT_FILES = ["company.md", "contact.md", "location.md", "web.md"];

async function deleteOldFormatFiles(rootPath: string, ctx: MigrationContext): Promise<void> {
  const bpDir = path.join(rootPath, "src", "content", "business-profile");
  for (const lang of await readLocalesSafe(rootPath, ctx)) {
    for (const fileName of OLD_FORMAT_FILES) {
      const filePath = path.join(bpDir, lang, fileName);
      try {
        const raw = await fs.readFile(filePath, "utf8");
        if (!raw.includes("schema:")) {
          await fs.unlink(filePath);
          ctx.logger.info(
            `[migrator rfc-0483] deleted old-format ${path.relative(rootPath, filePath)}`,
          );
        }
      } catch {
        // File doesn't exist or is PBP-format — skip
      }
    }
  }
}

async function transformReferences(
  data: SternsystemData,
  ctx: MigrationContext,
): Promise<SternsystemData> {
  await migrateReferences(data.rootPath, ctx);
  await copyPbpEntitiesFromUk(data.rootPath, ctx);
  await populatePresentationFields(data.rootPath, ctx);
  await removeBusinessCollectionFromConfig(data.rootPath, ctx);
  await deleteBusinessDirectory(data.rootPath, ctx);
  await deleteOldFormatFiles(data.rootPath, ctx);
  return data;
}

export const rfc0483Migrator: Migrator = {
  id: RFC_0483_MIGRATOR_ID,
  fromVersion: "4.5.0",
  toVersion: "4.6.0",
  description:
    "Migrate {business.*} content references to {business-profile.*} and remove stopgap collection",
  transform: async (data, ctx) => {
    return transformReferences(data, ctx);
  },
};
