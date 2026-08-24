/*
<MODULE_CONTRACT>
  <purpose>Semantic fingerprint of the platform tree (packages, integrations, services) — shared by site-kernel-checks and site-kernel-handoff.</purpose>
  <non-goals>
    <item>Do not include bundle IO or lock/manifest reading — those stay in site-kernel-handoff/bundle-io.ts.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Extracted from site-kernel-handoff/src/bundle-io.ts to break cyclic dependency (ADR-0015).</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import path from "node:path";
import { byteHash } from "@warpgogol/werkstatt-engine/fingerprint";
import { fingerprintTree } from "@warpgogol/werkstatt-engine/fingerprint/semantic";

/**
 * RFC-0364: Semantic fingerprint of the recipient's platform tree.
 *
 * Uses @warpgogol/fingerprint to produce a parser-backed semantic hash that is
 * invariant under formatting-only and comment-only changes. This is the
 * platform drift signal for new Sternsystem/release surfaces.
 *
 * RFC-0533: extended to cover packages/, integrations/, and services/ —
 * the full platform scope. Non-existent directories are skipped gracefully.
 */
export async function resolvePlatformSemanticHash(workspaceRoot: string): Promise<string> {
  const ignore = ["node_modules", ".turbo", "dist", ".astro"];
  const scopeDirs = ["packages", "integrations", "services"];
  const allResults: { rel: string; hash: string }[] = [];

  for (const dir of scopeDirs) {
    const absDir = path.join(workspaceRoot, dir);
    try {
      await fs.access(absDir);
    } catch {
      continue;
    }
    const result = await fingerprintTree(absDir, {
      mode: "semantic",
      root: workspaceRoot,
      ignore,
    });
    for (const file of result.files ?? []) {
      const rel = path.relative(workspaceRoot, file.path);
      allResults.push({ rel, hash: file.hash });
    }
  }

  allResults.sort((a, b) => a.rel.localeCompare(b.rel));
  const combinedInput = allResults.map((r) => `${r.rel}\n${r.hash}`).join("\n");
  return byteHash(combinedInput);
}
