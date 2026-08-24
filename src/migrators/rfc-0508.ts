/*
<MODULE_CONTRACT>
<purpose>RFC-0508: Participant data model migrator — transforms existing Person records
in people/<lang>/*.md by adding participantType: human, status, visibility, relationshipType,
and consent placeholder fields if absent. Idempotent: running twice produces the same result.</purpose>
<non-goals>
  <item>Do not remove existing Person fields — only add new Participant fields.</item>
  <item>Do not set real consent data — the consent placeholder uses the person's own slug as
  profileReviewer and a fixed consentDate. Operators must review and update after migration.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0508: initial migrator — add participantType, status, visibility, relationshipType, consent to Person records.</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import path from "node:path";
import type { Migrator, SternsystemData, MigrationContext } from "./types.ts";
import { MigrationError } from "./types.ts";

export const RFC_0508_MIGRATOR_ID = "rfc-0508";

const AFFILIATION_TO_RELATIONSHIP: Record<string, string> = {
  founder: "founder",
  board: "board",
  team: "team",
  patron: "patron",
  author: "author",
};

function addFieldToFrontmatter(content: string, fieldName: string, fieldValue: string): string {
  const frontmatterMatch = /^---\n([\s\S]*?)\n---/.exec(content);
  if (!frontmatterMatch) return content;
  const frontmatter = frontmatterMatch[1]!;
  if (new RegExp(`^${fieldName}:`, "m").test(frontmatter)) {
    return content;
  }
  const insertion = `${fieldName}: ${fieldValue}\n`;
  return content.replace(/^---\n([\s\S]*?)\n---/, `---\n$1\n${insertion}---`);
}

function extractAffiliations(content: string): string[] {
  const match = /^affiliations:\s*\[([^\]]*)\]/m.exec(content);
  if (!match) return [];
  return match[1]!
    .split(",")
    .map((s) => s.trim().replace(/["']/g, ""))
    .filter(Boolean);
}

function extractSlug(content: string): string {
  const match = /^slug:\s*"?([^"\n]+)"?/m.exec(content);
  return match ? match[1]!.trim() : "";
}

function extractPageEnabled(content: string): boolean {
  const match = /^page:\s*\n\s*enabled:\s*(\w+)/m.exec(content);
  if (!match) return false;
  return match[1] === "true";
}

export const rfc0508Migrator: Migrator = {
  id: RFC_0508_MIGRATOR_ID,
  fromVersion: "4.15.0",
  toVersion: "4.16.0",
  description:
    "Add participantType: human, status, visibility, relationshipType, and consent placeholder to Person records in people/<lang>/*.md. Advances migratorCursor for RFC-0508 (Participant data model).",
  transform: async (data: SternsystemData, ctx: MigrationContext) => {
    const peopleBaseDir = path.join(data.rootPath, "src", "content", "people");

    let langDirs: string[];
    try {
      langDirs = await fs.readdir(peopleBaseDir);
    } catch {
      ctx.logger.info(`[rfc-0508] no people directory at ${peopleBaseDir} — skipping`);
      langDirs = [];
    }

    for (const lang of langDirs) {
      const langPath = path.join(peopleBaseDir, lang);
      const stat = await fs.stat(langPath).catch(() => null);
      if (!stat?.isDirectory()) continue;

      const peopleFiles = (await fs.readdir(langPath)).filter((f) => f.endsWith(".md"));
      for (const peopleFile of peopleFiles) {
        const filePath = path.join(langPath, peopleFile);
        let content: string;
        try {
          content = await fs.readFile(filePath, "utf-8");
        } catch {
          continue;
        }

        let modified = false;
        let updated = content;

        // Add participantType: human if absent
        if (!/^participantType:/m.test(updated)) {
          updated = addFieldToFrontmatter(updated, "participantType", "human");
          modified = true;
        }

        // Add status based on page.enabled
        if (!/^status:/m.test(updated)) {
          const pageEnabled = extractPageEnabled(updated);
          updated = addFieldToFrontmatter(updated, "status", pageEnabled ? "active" : "draft");
          modified = true;
        }

        // Add visibility based on page.enabled
        if (!/^visibility:/m.test(updated)) {
          const pageEnabled = extractPageEnabled(updated);
          updated = addFieldToFrontmatter(
            updated,
            "visibility",
            pageEnabled ? "public" : "private",
          );
          modified = true;
        }

        // Add relationshipType derived from affiliations
        if (!/^relationshipType:/m.test(updated)) {
          const affiliations = extractAffiliations(updated);
          const primaryAffiliation = affiliations[0] ?? "team";
          const relationship = AFFILIATION_TO_RELATIONSHIP[primaryAffiliation] ?? "team";
          updated = addFieldToFrontmatter(updated, "relationshipType", relationship);
          modified = true;
        }

        // Add consent placeholder for public humans
        if (!/^consent:/m.test(updated)) {
          const slug = extractSlug(updated);
          const pageEnabled = extractPageEnabled(updated);
          if (pageEnabled && slug) {
            const consentYaml = `consent:\n  consentRecordId: "consent-${slug}"\n  approvedFields: ["lifespan.born", "location", "bio", "photo", "sameAs"]\n  consentDate: "2026-07-24"\n  profileReviewer: "${slug}"`;
            const frontmatterMatch = /^---\n([\s\S]*?)\n---/.exec(updated);
            if (frontmatterMatch) {
              updated = updated.replace(/^---\n([\s\S]*?)\n---/, `---\n$1\n${consentYaml}\n---`);
              modified = true;
            }
          }
        }

        if (modified) {
          try {
            await fs.writeFile(filePath, updated, "utf-8");
            ctx.logger.info(`[rfc-0508] updated participant record: ${lang}/${peopleFile}`);
          } catch (err) {
            throw new MigrationError(
              RFC_0508_MIGRATOR_ID,
              filePath,
              "",
              `Failed to update participant record: ${(err as Error).message}`,
            );
          }
        }
      }
    }

    return data;
  },
};
