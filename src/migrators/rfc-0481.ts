/*
<MODULE_CONTRACT>
<purpose>RFC-0481: content migrator — creates the PBP business singleton
(business-profile/{lang}/business.md) from legacy business/{lang}/company.md
frontmatter. This completes the RFC-0471 content migration that was left incomplete.</purpose>
<non-goals>
  <item>Does not migrate content references ({business.*.*}) — that is a separate future RFC.</item>
  <item>Does not delete the legacy business/ directory — that is a separate future RFC.</item>
  <item>Does not create de/ locale PBP entities beyond business.md — operator-authored content.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0481: initial content migrator — create PBP business singleton from legacy company.md.</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import path from "node:path";
import type { Migrator, SternsystemData, MigrationContext } from "./types.ts";
import { MigrationError } from "./types.ts";
import { parseFrontmatter, serializeFrontmatter } from "./yaml-utils.ts";

export const RFC_0481_MIGRATOR_ID = "rfc-0481";

interface LegacyCompanyFrontmatter {
  brand?: { name?: string; author?: string };
  name?: string;
  description?: string;
  mission?: string;
  foundingYear?: string;
}

function mapCompanyToBusiness(
  frontmatter: Record<string, unknown>,
  _lang: string,
): Record<string, unknown> {
  const company = frontmatter as LegacyCompanyFrontmatter;
  const name = company.brand?.name ?? company.name ?? "Warpgogol";
  const description = company.description ?? "";
  const mission = company.mission ?? "";
  const yearEstablished = company.foundingYear ? parseInt(company.foundingYear, 10) : undefined;

  const business: Record<string, unknown> = {
    schema: "pbp/business@1",
    id: "https://warpgogol.com/id/business",
    type: "business",
    status: "published",
    name,
    description,
    mission,
    brandRefs: {
      default: {
        ref: "https://warpgogol.com/id/brand",
        expectedType: "brand",
      },
    },
    legalIdentityRef: {
      ref: "https://warpgogol.com/id/legal-identity",
      expectedType: "legal-identity",
    },
    placeRefs: {
      office: {
        ref: "https://warpgogol.com/id/places/backnang",
        expectedType: "place",
      },
    },
    contactPointRefs: {
      default: {
        ref: "https://warpgogol.com/id/contact-points/general-email",
        expectedType: "contact-point",
      },
    },
    webPresenceRefs: {
      default: {
        ref: "https://warpgogol.com/id/web-presences/primary",
        expectedType: "web-presence",
      },
    },
    governance: {
      authorityRef: "https://warpgogol.com/id/business",
      effectiveFrom: "2026-01-01",
      reviewEvery: "P1Y",
    },
  };

  if (yearEstablished !== undefined && !Number.isNaN(yearEstablished)) {
    business.yearEstablished = yearEstablished;
  }

  return business;
}

async function isPbpBusinessFile(filePath: string): Promise<boolean> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw.includes("schema: pbp/business@1") || raw.includes('schema: "pbp/business@1"');
  } catch {
    return false;
  }
}

async function transformBusinessSingleton(
  data: SternsystemData,
  ctx: MigrationContext,
): Promise<SternsystemData> {
  const locales = await readLocalesSafe(data.rootPath, ctx);

  for (const lang of locales) {
    const targetPath = path.join(
      data.rootPath,
      "src",
      "content",
      "business-profile",
      lang,
      "business.md",
    );

    if (await isPbpBusinessFile(targetPath)) {
      ctx.logger.info(
        `[migrator rfc-0481] business-profile/${lang}/business.md already PBP — skip`,
      );
      continue;
    }

    const sourcePath = path.join(data.rootPath, "src", "content", "business", lang, "company.md");

    let sourceRaw: string;
    try {
      sourceRaw = await fs.readFile(sourcePath, "utf8");
    } catch {
      throw new MigrationError(
        RFC_0481_MIGRATOR_ID,
        `src/content/business/${lang}/company.md`,
        "",
        "source file not found — cannot create PBP business singleton without legacy company.md",
      );
    }

    const { frontmatter } = parseFrontmatter(sourceRaw);
    const business = mapCompanyToBusiness(frontmatter, lang);
    const output = serializeFrontmatter(business);

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, output, "utf8");
    ctx.logger.info(`[migrator rfc-0481] created business-profile/${lang}/business.md`);
  }

  return data;
}

export async function readLocalesSafe(rootPath: string, ctx: MigrationContext): Promise<string[]> {
  const systemMdPath = path.join(rootPath, "src", "content", "system.md");
  try {
    const raw = await fs.readFile(systemMdPath, "utf8");
    const { frontmatter } = parseFrontmatter(raw);
    const i18n = frontmatter.i18n as
      { supported?: Record<string, unknown>; default?: string } | undefined;
    if (i18n?.supported && typeof i18n.supported === "object") {
      return Object.keys(i18n.supported);
    }
    if (i18n?.default) {
      return [i18n.default];
    }
  } catch {
    ctx.logger.info(`[migrator rfc-0481] no system.md found — defaulting to ["de"]`);
  }
  return ["de"];
}

export const rfc0481Migrator: Migrator = {
  id: RFC_0481_MIGRATOR_ID,
  fromVersion: "4.4.0",
  toVersion: "4.5.0",
  description: "Create PBP business singleton from legacy business/company.md",
  transform: async (data, ctx) => {
    return transformBusinessSingleton(data, ctx);
  },
};
