/*
<MODULE_CONTRACT>
<purpose>RFC-0221: detect and surface derived-file edits as decision records. When a derived
path in the bundle manifest has a hash mismatch (edited after packing), absorb raises a
decision record instead of silently regenerating, so hand edits are not lost without warning.</purpose>
<non-goals>
  <item>Do not modify files — pure detection.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0221: derived-edit detection for decision records.</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import path from "node:path";
import type { HandoffManifest } from "@warpgogol/werkstatt-engine/schemas";
import { sha256OfBytes } from "./bundle-io.ts";

export interface DerivedEditMismatch {
  path: string;
  expectedHash: string;
  actualHash: string | null;
}

/**
 * Check manifest derived entries against actual bundle file contents. Returns mismatches
 * where a derived file's hash does not match the stored hash (indicating post-pack edits).
 * Returns empty if no derived entries or all hashes match.
 */
export async function reportDerivedEdits(
  bundleDir: string,
  manifest: HandoffManifest,
): Promise<DerivedEditMismatch[]> {
  const mismatches: DerivedEditMismatch[] = [];

  for (const entry of manifest.entries) {
    if (entry.kind !== "derived") continue;

    const abs = path.join(bundleDir, entry.path);
    let actualHash: string | null = null;
    try {
      actualHash = sha256OfBytes(await fs.readFile(abs));
    } catch {
      // File absent (could have been deleted) — report as mismatch.
      actualHash = null;
    }

    if (actualHash !== entry.hash) {
      mismatches.push({
        path: entry.path,
        expectedHash: entry.hash,
        actualHash,
      });
    }
  }

  return mismatches.sort((a, b) => a.path.localeCompare(b.path));
}
