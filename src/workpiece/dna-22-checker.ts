/*
<MODULE_CONTRACT>
<purpose>
RFC-0555: DNA-22 path validation for workpiece.read and workpiece.write commands.
Checks whether a relative file path falls within the client-editable surface
declared in system.md clientEditable[] (DNA-22, RFC-0025; amended by RFC-0031).
</purpose>
<non-goals>
  <item>Does not validate clientEditable[] entries themselves — that is client.edit.validate's job.</item>
  <item>Does not handle system.md partial field edits — future enhancement.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0555: initial DNA-22 path validation for workpiece commands.</item>
</CHANGE_SUMMARY>
*/

import path from "node:path";
import { loadSystemManifest } from "@warpgogol/werkstatt-shared/content";

const CONTENT_PREFIX = "src/content/";

export interface ClientEditableChecker {
  isClientEditable(workpieceRoot: string, relativePath: string): Promise<boolean>;
}

export async function isClientEditable(
  workpieceRoot: string,
  relativePath: string,
): Promise<boolean> {
  const normalizedPath = relativePath.replace(/\\/g, "/").replace(/^\.\//, "");

  const contentDir = path.join(workpieceRoot, "src", "content");
  const manifest = await loadSystemManifest(contentDir);
  const entries = manifest.manifest.clientEditable ?? [];

  const stripped = stripContentPrefix(normalizedPath);
  if (stripped === null) return false;

  for (const entry of entries) {
    const normalizedEntry = entry.replace(/^\//, "");
    if (stripped === normalizedEntry || stripped.startsWith(`${normalizedEntry}/`)) {
      return true;
    }
  }

  if (normalizedPath.endsWith(".client.ts") && normalizedPath.startsWith(CONTENT_PREFIX)) {
    return true;
  }

  if (normalizedPath.includes("/assets/") && normalizedPath.startsWith(CONTENT_PREFIX)) {
    return true;
  }

  return false;
}

function stripContentPrefix(p: string): string | null {
  if (!p.startsWith(CONTENT_PREFIX)) return null;
  return p.slice(CONTENT_PREFIX.length);
}

export function createClientEditableChecker(): ClientEditableChecker {
  return {
    isClientEditable,
  };
}
