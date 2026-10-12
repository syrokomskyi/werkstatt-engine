/*
<MODULE_CONTRACT>
<purpose>
  RFC-1263: fast-lane eligibility for mission.content-edit — decides whether
  a mission's touched set resolves entirely inside the editable content
  surface. Two input shapes: a parsed ops file (new missions) or the
  workpiece's git-status file list (open-mission reuse). Re-evaluates the
  live system manifest on every call — eligibility is never cached.
</purpose>
<non-goals>
  <item>Do not apply or plan ops — content-ops/apply.ts owns mutation.</item>
  <item>Do not loosen the conservative surface: block.* ops, system.md
  selectors, render-affecting props (background/density/effects),
  platform-scope files, and non-editable generated paths all route to the
  full lane.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1263: initial eligibility module — CAM-aware file surface via
  resolveContentAuthority (legacy clientEditable projection when no
  authority block), generated-path guard, structural-op exclusion.</item>
  <item>RFC-1263</item>
</CHANGE_SUMMARY>
*/

import path from "node:path";

import { loadSystemManifest } from "@warpgogol/werkstatt-shared/content";
import type { CamFieldClass, SystemManifest } from "@warpgogol/werkstatt-shared/ontology/schemas";
import {
  loadGeneratedPathRegistry,
  generatedWriteGuard,
  type GeneratedPathRegistry,
} from "@warpgogol/werkstatt-shared/kernel/generated-paths";
import { resolveContentAuthority } from "@warpgogol/werkstatt-shared/authority";
import type { WorkspaceIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";

const CONTENT_PREFIX = "src/content/";
const PLATFORM_PREFIXES = ["packages/", "services/", "integrations/"];

/**
 * Block props that drive rendering — the RFC-1263 risk carve-out: mutating
 * them can break the visual contract in ways scoped validators cannot see,
 * so they always route to the full lane.
 */
const RENDER_AFFECTING_PROPS = new Set(["background", "density", "effects"]);

/** Field classes that never qualify for the fast lane. */
const FULL_LANE_CLASSES: ReadonlySet<CamFieldClass> = new Set(["structural", "shell"]);

/** The mutation-scope level a fast-lane op requires (matches content-ops). */
const FAST_LANE_OP_LEVEL = 2;

export interface ContentEditOpRef {
  /** Ops-file op kind: set | patch | block.insert | block.move | block.remove. */
  kind: string;
  collection: string;
  file: string;
  fieldPath: string;
  /** Explicit ops-file fieldClass override (content-ops honors it first). */
  fieldClass?: string;
}

export interface EligibilityResult {
  eligible: boolean;
  reasons: string[];
}

/** Mirrors content-ops/apply.ts deriveFieldClass — kept in sync by contract. */
function opFieldClass(op: ContentEditOpRef): CamFieldClass {
  if (
    op.fieldClass === "structural" ||
    op.fieldClass === "shell" ||
    op.fieldClass === "navigation" ||
    op.fieldClass === "narrative" ||
    op.fieldClass === "claims" ||
    op.fieldClass === "product" ||
    op.fieldClass === "legal" ||
    op.fieldClass === "media"
  ) {
    return op.fieldClass;
  }
  if (op.collection === "navigation") return "navigation";
  if (op.collection === "system") return "shell";
  if (op.kind.startsWith("block.")) return "structural";
  return "narrative";
}

/** Terminal prop name of an op's field path (last `.seg`, pred stripped). */
function terminalProp(fieldPath: string): string {
  const last = fieldPath.split(".").pop() ?? "";
  return last.replace(/\[.*\]$/, "");
}

/**
 * Path-level editability for one site-relative file: under src/content/,
 * inside the CAM-projected agent surface when an authority block exists,
 * else inside clientEditable[] (+ the .client.ts/assets content rules).
 */
function fileEditable(
  manifest: SystemManifest,
  registry: GeneratedPathRegistry | null,
  relPath: string,
): { editable: boolean; reason?: string } {
  if (PLATFORM_PREFIXES.some((p) => relPath.startsWith(p))) {
    return { editable: false, reason: "platform-scope path" };
  }
  if (!relPath.startsWith(CONTENT_PREFIX)) {
    return { editable: false, reason: "outside src/content/" };
  }
  const verdict = generatedWriteGuard(registry, relPath);
  if (!verdict.allowed) {
    return {
      editable: false,
      reason: `non-editable generated path${verdict.owner ? ` (owner: ${verdict.owner})` : ""}`,
    };
  }
  if (manifest.authority) {
    const cam = resolveContentAuthority(manifest, {
      subject: "agent-session",
      fieldClass: "narrative",
      path: relPath,
      level: FAST_LANE_OP_LEVEL,
    });
    return cam.allowed
      ? { editable: true }
      : { editable: false, reason: `CAM denies agent-session (source: ${cam.source})` };
  }
  const stripped = relPath.slice(CONTENT_PREFIX.length).replace(/\.(md|yaml|yml|json)$/i, "");
  const entries = manifest.clientEditable ?? [];
  if (
    entries.some((e) => {
      const n = e.replace(/^\//, "");
      return stripped === n || stripped.startsWith(`${n}/`);
    })
  ) {
    return { editable: true };
  }
  if (relPath.endsWith(".client.ts") || relPath.includes("/assets/")) {
    return { editable: true };
  }
  return { editable: false, reason: "outside clientEditable[]" };
}

/**
 * Evaluates fast-lane eligibility for a touched set.
 * - `files`: workpiece-relative changed paths (open-mission reuse).
 * - `ops`: parsed ops-file ops (selectors already split into collection/file/fieldPath).
 * Either or both may be given; the set is the union.
 */
export async function evaluateContentEditEligibility(input: {
  siteDir: string;
  files?: string[];
  ops?: ContentEditOpRef[];
  io: WorkspaceIO;
}): Promise<EligibilityResult> {
  const { siteDir, io } = input;
  const reasons: string[] = [];

  const contentDir = path.join(siteDir, "src", "content");
  let manifest: SystemManifest;
  try {
    manifest = (await loadSystemManifest(contentDir, io)).manifest;
  } catch (err) {
    return {
      eligible: false,
      reasons: [
        `cannot read ${contentDir}/system.md: ${err instanceof Error ? err.message : String(err)}`,
      ],
    };
  }
  const registry = await loadGeneratedPathRegistry(siteDir, io);

  for (const relPath of input.files ?? []) {
    const normalized = relPath.replace(/\\/g, "/").replace(/^\.\//, "");
    const check = fileEditable(manifest, registry, normalized);
    if (!check.editable) reasons.push(`${normalized}: ${check.reason}`);
  }

  for (const op of input.ops ?? []) {
    const cls = opFieldClass(op);
    const label = `${op.collection}/${op.file}${op.fieldPath ? `#${op.fieldPath}` : ""}`;
    if (FULL_LANE_CLASSES.has(cls)) {
      reasons.push(`${label}: ${op.kind} resolves field class "${cls}" — full lane`);
      continue;
    }
    if (RENDER_AFFECTING_PROPS.has(terminalProp(op.fieldPath))) {
      reasons.push(`${label}: render-affecting prop "${terminalProp(op.fieldPath)}" — full lane`);
      continue;
    }
    // `system` ops already rejected above via the "shell" field class.
    const relPath = `${CONTENT_PREFIX}${op.collection}/${op.file}`;
    const check = fileEditable(manifest, registry, relPath);
    if (!check.editable) reasons.push(`${label}: ${check.reason}`);
  }

  return { eligible: reasons.length === 0, reasons };
}
