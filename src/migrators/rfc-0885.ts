/*
<MODULE_CONTRACT>
<purpose>RFC-0885: PBP evidence schema migrator — transforms existing Nachweis consent and
evidence-source entities to the new consentScope and display fields. Idempotent: running
twice produces the same result.</purpose>
<non-goals>
  <item>Does not create new entities — only transforms existing ones.</item>
  <item>Does not set websiteUrl or websiteScreenshot — operators add those manually after migration.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0885: initial migrator — consentStatus/grantedAt/method → consentScope, add default display to Nachweis evidence kinds.</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import path from "node:path";
import {
  parseMarkdownFrontmatter,
  stringifyMarkdownFrontmatter,
} from "@warpgogol/werkstatt-shared/content";
import type { Migrator, SternsystemData, MigrationContext } from "./types.ts";
import { MigrationError } from "./types.ts";

export const RFC_0885_MIGRATOR_ID = "rfc-0885";

const NACHWEIS_EVIDENCE_KINDS = new Set([
  "client-statement",
  "project-confirmation",
  "certificate",
  "operational-evidence",
  "technical-assessment",
]);

const DEFAULT_NOT_REQUESTED = {
  status: "not_requested",
  grantedAt: null,
  method: "none",
};

function mapConsentStatus(
  oldStatus: string,
  oldGrantedAt: string | null,
  oldMethod: string,
): { document: unknown; screenshot: unknown; websiteLink: unknown } {
  switch (oldStatus) {
    case "partially_granted":
    case "granted":
      return {
        document: {
          status: "granted",
          grantedAt: oldGrantedAt,
          method: oldMethod,
        },
        screenshot: { ...DEFAULT_NOT_REQUESTED },
        websiteLink: { ...DEFAULT_NOT_REQUESTED },
      };
    case "revoked":
      return {
        document: { status: "denied", grantedAt: null, method: "none" },
        screenshot: { ...DEFAULT_NOT_REQUESTED },
        websiteLink: { ...DEFAULT_NOT_REQUESTED },
      };
    case "not_requested":
    case "requested":
    case "expired":
    default:
      return {
        document: { ...DEFAULT_NOT_REQUESTED },
        screenshot: { ...DEFAULT_NOT_REQUESTED },
        websiteLink: { ...DEFAULT_NOT_REQUESTED },
      };
  }
}

async function migrateConsentFiles(
  rootPath: string,
  ctx: MigrationContext,
): Promise<void> {
  const bpBaseDir = path.join(rootPath, "src", "content", "business-profile");

  let langDirs: string[];
  try {
    langDirs = await fs.readdir(bpBaseDir);
  } catch {
    ctx.logger.info(`[rfc-0885] no business-profile directory at ${bpBaseDir} — skipping consent migration`);
    return;
  }

  for (const lang of langDirs) {
    const consentDir = path.join(bpBaseDir, lang, "consent");
    const stat = await fs.stat(consentDir).catch(() => null);
    if (!stat?.isDirectory()) continue;

    const files = (await fs.readdir(consentDir)).filter((f) => f.endsWith(".md"));
    for (const file of files) {
      const filePath = path.join(consentDir, file);
      let content: string;
      try {
        content = await fs.readFile(filePath, "utf-8");
      } catch {
        continue;
      }

      const { data, content: body } = parseMarkdownFrontmatter(content);

      // Skip if already migrated (consentScope present, no consentStatus)
      if (data.consentScope != null && data.consentStatus == null) continue;
      // Skip if no old fields and no consentScope — nothing to migrate
      if (data.consentStatus == null && data.consentScope == null) continue;

      const oldStatus = (data.consentStatus as string | undefined) ?? "not_requested";
      const oldGrantedAt = (data.grantedAt as string | null | undefined) ?? null;
      const oldMethod = (data.method as string | undefined) ?? "none";

      const scope = mapConsentStatus(oldStatus, oldGrantedAt, oldMethod);
      data.consentScope = scope;
      delete data.consentStatus;
      delete data.grantedAt;
      delete data.method;

      const updated = stringifyMarkdownFrontmatter(body, data);
      try {
        await fs.writeFile(filePath, updated, "utf-8");
        ctx.logger.info(`[rfc-0885] migrated consent: ${lang}/${file}`);
      } catch (err) {
        throw new MigrationError(
          RFC_0885_MIGRATOR_ID,
          filePath,
          "consentScope",
          `Failed to update consent entity: ${(err as Error).message}`,
        );
      }
    }
  }
}

async function migrateEvidenceSourceFiles(
  rootPath: string,
  ctx: MigrationContext,
): Promise<void> {
  const bpBaseDir = path.join(rootPath, "src", "content", "business-profile");

  let langDirs: string[];
  try {
    langDirs = await fs.readdir(bpBaseDir);
  } catch {
    return;
  }

  for (const lang of langDirs) {
    const esDir = path.join(bpBaseDir, lang, "evidence-source");
    const stat = await fs.stat(esDir).catch(() => null);
    if (!stat?.isDirectory()) continue;

    const files = (await fs.readdir(esDir)).filter((f) => f.endsWith(".md"));
    for (const file of files) {
      const filePath = path.join(esDir, file);
      let content: string;
      try {
        content = await fs.readFile(filePath, "utf-8");
      } catch {
        continue;
      }

      const { data, content: body } = parseMarkdownFrontmatter(content);

      // Only migrate Nachweis evidence kinds
      const kind = data.kind as string | undefined;
      if (kind == null || !NACHWEIS_EVIDENCE_KINDS.has(kind)) continue;

      // Skip if display already present
      if (data.display != null) continue;

      // Add default display: document visible, others hidden
      data.display = {
        document: "visible",
        screenshot: "hidden",
        websiteLink: "hidden",
      };

      const updated = stringifyMarkdownFrontmatter(body, data);
      try {
        await fs.writeFile(filePath, updated, "utf-8");
        ctx.logger.info(`[rfc-0885] migrated evidence-source: ${lang}/${file}`);
      } catch (err) {
        throw new MigrationError(
          RFC_0885_MIGRATOR_ID,
          filePath,
          "display",
          `Failed to update evidence-source entity: ${(err as Error).message}`,
        );
      }
    }
  }
}

export const rfc0885Migrator: Migrator = {
  id: RFC_0885_MIGRATOR_ID,
  fromVersion: "6.22.0",
  toVersion: "6.23.0",
  description:
    "Transform existing Nachweis consent entities (consentStatus/grantedAt/method → consentScope) and add default display to Nachweis evidence-source entities. Advances migratorCursor for RFC-0885 (PBP evidence schema display control, granular consent, website fields).",
  transform: async (data: SternsystemData, ctx: MigrationContext) => {
    await migrateConsentFiles(data.rootPath, ctx);
    await migrateEvidenceSourceFiles(data.rootPath, ctx);
    return data;
  },
};
