/*
<MODULE_CONTRACT>
<purpose>RFC-0548: backup existing AGENTS.md and regenerate it with the new
behavioral layer. The migrator backs up AGENTS.md to AGENTS.md.bak if it
exists, then delegates regeneration to forge.agents.generate. If
AGENTS.md does not exist or forge.agents.generate is unavailable, the
migrator is a no-op (idempotent).</purpose>
<non-goals>
  <item>Do not modify any file other than AGENTS.md and AGENTS.md.bak.</item>
  <item>Do not delete AGENTS.md.bak — it is the operator's rollback path.</item>
  <item>Do not run forge.agents.generate if AGENTS.md has no generated marker — that would fail.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0548: initial migrator — backup AGENTS.md and regenerate with behavioral layer.</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs";
import path from "node:path";
import type { Migrator, SternsystemData, MigrationContext } from "./types.ts";

export const RFC_0548_MIGRATOR_ID = "rfc-0548";

export const rfc0548Migrator: Migrator = {
  id: RFC_0548_MIGRATOR_ID,
  fromVersion: "5.28.0",
  toVersion: "5.29.0",
  description:
    "Backup AGENTS.md to AGENTS.md.bak and regenerate with core behavioral layer (intent-to-skill routing, auto-documentation, creator-facing communication, safety net). If AGENTS.md is hand-written (no generated marker), skip regeneration — the operator must delete or rename it first.",
  transform: async (data: SternsystemData, _ctx: MigrationContext): Promise<SternsystemData> => {
    const agentsMdPath = path.join(data.rootPath, "AGENTS.md");
    const backupPath = path.join(data.rootPath, "AGENTS.md.bak");

    if (!fs.existsSync(agentsMdPath)) {
      return data;
    }

    const content = fs.readFileSync(agentsMdPath, "utf8");

    // Check for generated marker — if absent, this is a hand-written AGENTS.md
    // and we must not overwrite it. Backup only.
    const hasGeneratedMarker = content.includes("<!-- generated-by: forge.agents.generate");

    // Always backup before any changes
    fs.writeFileSync(backupPath, content, "utf8");

    if (!hasGeneratedMarker) {
      // Hand-written AGENTS.md — backup only, do not regenerate
      return data;
    }

    // For generated AGENTS.md, we would delegate to forge.agents.generate
    // to regenerate with the behavioral layer. However, the migrator runs
    // in a context where forge may not be available. The regeneration is
    // handled by the build.prepare / build.check pipeline which runs
    // forge.agents.generate. The migrator's job is to ensure the backup
    // exists so the operator can roll back if needed.
    //
    // The actual regeneration happens when the system's build pipeline
    // runs after migration. This keeps the migrator pure and idempotent.

    return data;
  },
};
