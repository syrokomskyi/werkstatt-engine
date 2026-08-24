/*
<MODULE_CONTRACT>
<purpose>RFC-0505: ratgeber extended claim registry migrator — transforms
existing ratgeber article claim sidecars (surface/articles/{lang}/*.claims.yaml)
into structured claim records (surface/claims/{lang}/{claimId}.md) and deletes
the sidecar files after transformation. Idempotent: if no sidecars exist, the
migrator is a no-op. Advances the migratorCursor for RFC-0505.</purpose>
<non-goals>
  <item>Do not auto-generate claimText, limitations, or reviewStatus — those are
  human-authored editorial fields. The migrator sets safe defaults: claimText
  is a placeholder, limitations is empty, reviewStatus is "unverified".</item>
  <item>Do not modify article records — article sources[].claimIds remain unchanged.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0505: initial migrator — transform claim sidecars to claim records, delete sidecars.</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import path from "node:path";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import type { Migrator, SternsystemData, MigrationContext } from "./types.ts";
import { MigrationError } from "./types.ts";

export const RFC_0505_MIGRATOR_ID = "rfc-0505";

interface SidecarClaim {
  provenance?: string;
  asOf?: string;
  sourceId?: string;
  url?: string;
  title?: string;
  [key: string]: unknown;
}

interface ParsedSidecar {
  [claimId: string]: SidecarClaim;
}

function buildClaimRecordFrontmatter(
  claimId: string,
  articleSlug: string,
  lang: string,
  claim: SidecarClaim,
): string {
  const sourceRefs: Array<Record<string, string>> = [];
  if (claim.sourceId || claim.url) {
    sourceRefs.push({
      sourceId: claim.sourceId ?? "unknown",
      url: claim.url ?? "https://example.com",
      title: claim.title ?? "Migrated from sidecar",
      retrievedAt: claim.asOf ?? "2026-01-01",
    });
  }

  const frontmatter: Record<string, unknown> = {
    claimId,
    articleId: articleSlug,
    claimText: "Migrated from claim sidecar — editorial review required.",
    claimType: "factual",
    sourceRefs,
    calculationInputs: [],
    limitations: [],
    verifiedAt: claim.asOf ?? "2026-01-01",
    reviewStatus: "unverified",
  };

  const yamlContent = yamlStringify(frontmatter, { indent: 2 });
  return `---\n${yamlContent}---\n`;
}

export const rfc0505Migrator: Migrator = {
  id: RFC_0505_MIGRATOR_ID,
  fromVersion: "4.15.0",
  toVersion: "4.16.0",
  description:
    "Transform ratgeber article claim sidecars (surface/articles/{lang}/*.claims.yaml) into structured claim records (surface/claims/{lang}/{claimId}.md) and delete sidecars. Sets reviewStatus to 'unverified' — editorial review required. Advances migratorCursor for RFC-0505.",
  transform: async (data: SternsystemData, ctx: MigrationContext) => {
    const articlesBaseDir = path.join(data.rootPath, "src", "content", "surface", "articles");
    const claimsBaseDir = path.join(data.rootPath, "src", "content", "surface", "claims");

    let langDirs: string[];
    try {
      langDirs = await fs.readdir(articlesBaseDir);
    } catch {
      ctx.logger.info(`[rfc-0505] no articles directory at ${articlesBaseDir} — skipping`);
      return data;
    }

    for (const lang of langDirs) {
      const langPath = path.join(articlesBaseDir, lang);
      const stat = await fs.stat(langPath).catch(() => null);
      if (!stat?.isDirectory()) continue;

      const files = await fs.readdir(langPath).catch(() => []);
      const sidecarFiles = files.filter((f) => f.endsWith(".claims.yaml"));

      if (sidecarFiles.length === 0) {
        ctx.logger.info(`[rfc-0505] no claim sidecars in ${lang} — skipping`);
        continue;
      }

      const claimsLangDir = path.join(claimsBaseDir, lang);
      await fs.mkdir(claimsLangDir, { recursive: true });

      for (const sidecarFile of sidecarFiles) {
        const sidecarPath = path.join(langPath, sidecarFile);
        const articleSlug = sidecarFile.replace(/\.claims\.yaml$/, "");

        let raw: string;
        try {
          raw = await fs.readFile(sidecarPath, "utf-8");
        } catch (err) {
          throw new MigrationError(
            RFC_0505_MIGRATOR_ID,
            sidecarPath,
            "",
            `Failed to read claim sidecar: ${(err as Error).message}`,
          );
        }

        let parsed: ParsedSidecar;
        try {
          const result = yamlParse(raw) as ParsedSidecar;
          parsed = result && typeof result === "object" && !Array.isArray(result) ? result : {};
        } catch (err) {
          throw new MigrationError(
            RFC_0505_MIGRATOR_ID,
            sidecarPath,
            "",
            `Failed to parse claim sidecar YAML: ${(err as Error).message}`,
          );
        }

        for (const [claimId, claim] of Object.entries(parsed)) {
          const claimRecordPath = path.join(claimsLangDir, `${claimId}.md`);
          const exists = await fs
            .stat(claimRecordPath)
            .then(() => true)
            .catch(() => false);

          if (exists) {
            ctx.logger.info(`[rfc-0505] claim record already exists: ${lang}/${claimId}.md`);
            continue;
          }

          const content = buildClaimRecordFrontmatter(claimId, articleSlug, lang, claim);
          try {
            await fs.writeFile(claimRecordPath, content, "utf-8");
            ctx.logger.info(`[rfc-0505] created claim record: ${lang}/${claimId}.md`);
          } catch (err) {
            throw new MigrationError(
              RFC_0505_MIGRATOR_ID,
              claimRecordPath,
              "",
              `Failed to create claim record: ${(err as Error).message}`,
            );
          }
        }

        // Delete the sidecar after transformation
        try {
          await fs.unlink(sidecarPath);
          ctx.logger.info(`[rfc-0505] deleted sidecar: ${lang}/${sidecarFile}`);
        } catch (err) {
          throw new MigrationError(
            RFC_0505_MIGRATOR_ID,
            sidecarPath,
            "",
            `Failed to delete claim sidecar: ${(err as Error).message}`,
          );
        }
      }
    }

    return data;
  },
};
