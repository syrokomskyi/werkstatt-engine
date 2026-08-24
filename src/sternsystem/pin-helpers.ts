/*
<MODULE_CONTRACT>
<purpose>Shared helpers for sternsystem pin generation: highestRfcId extraction and snapshotCapabilities projection from the workspace.</purpose>
<non-goals>
  <item>Do not include pin writing or registry update logic — those belong to the command handlers.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0381: extracted highestRfcId and snapshotCapabilities from sternsystem-extract.ts and sternsystem-pin.ts to eliminate duplication.</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { SystemPin } from "@warpgogol/werkstatt-engine/schemas";

export async function highestRfcId(workspaceRoot: string): Promise<string> {
  try {
    const files = await fs.readdir(path.join(workspaceRoot, "docs", "rfcs"));
    let max = 0;
    for (const f of files) {
      const m = /^[Rr][Ff][Cc]-(\d{4})/.exec(f);
      if (m) max = Math.max(max, Number(m[1]));
    }
    return `RFC-${String(max).padStart(4, "0")}`;
  } catch {
    return "RFC-0000";
  }
}

export async function snapshotCapabilities(
  workspaceRoot: string,
): Promise<SystemPin["capabilities"]> {
  try {
    const raw = await fs.readFile(path.join(workspaceRoot, "uni.registry.yaml"), "utf8");
    const parsed = parseYaml(raw) as {
      entries?: Array<{ id: string; semanticId?: string; version?: string; intent?: string[] }>;
    };
    return (parsed.entries ?? [])
      .filter((e) => e.id)
      .map((e) => ({
        semanticId: e.semanticId ?? e.id,
        version: e.version ?? "0.0.0",
        intent: e.intent ?? [],
      }));
  } catch {
    return [];
  }
}
