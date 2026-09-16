/*
<MODULE_CONTRACT>
  <purpose>Semantic fingerprint of the platform tree (packages, integrations, services) — shared by site-kernel-checks and site-kernel-handoff.</purpose>
  <non-goals>
    <item>Do not include bundle IO or lock/manifest reading — those stay in site-kernel-handoff/bundle-io.ts.</item>
  </non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>The fingerprint covers the platform tree only — site content is excluded by design.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
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
