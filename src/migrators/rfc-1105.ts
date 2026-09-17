/*
<MODULE_CONTRACT>
<purpose>RFC-1105: share-path-rewrite migrator — rewrites stale
`@warpgogol/werkstatt-shared/share/X` import specifiers in workpiece authored
sources to the post-dissolution top-level subpaths. Idempotent: specifiers
without the `/share` segment are untouched.</purpose>
<non-goals>
  <item>Does not move or delete files — specifier rewrite only.</item>
  <item>Does not resolve the bare `…/share` barrel specifier — logged as a warning for manual repair (no default target exists after dissolution).</item>
  <item>Does not touch `@warpgogol/werkstatt-site/share/*` — different package, live namespace.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1105: initial migrator — explicit destination table + identity promotion for domain dirs, warn-only for removed/bare specifiers.</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import path from "node:path";
import type { Migrator, SternsystemData, MigrationContext } from "./types.ts";

export const RFC_1105_MIGRATOR_ID = "rfc-1105";

const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".astro", ".md", ".mdx", ".mjs", ".js"]);
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".astro",
  ".cache",
  ".turbo",
  ".wrangler",
  ".git",
]);

const SPECIFIER_RE = /@warpgogol\/werkstatt-shared\/share(\/[A-Za-z0-9_.\-/]*)?/g;

/**
 * Non-identity destinations — longest-prefix match wins.
 * Mirrors the RFC-1105 destination map exactly.
 */
const EXPLICIT_MAP: ReadonlyArray<readonly [string, string]> = [
  // Node-only exiles (must precede the `semantic` identity rule)
  ["semantic/markdown-twin-provenance", "node/semantic/markdown-twin-provenance"],
  ["semantic/derived-prices-loader", "node/semantic/derived-prices-loader"],
  ["fs", "node/fs"],
  ["import-scan", "node/import-scan"],
  ["dev-props-validator", "node/dev-props-validator"],
  // Browser-only
  ["scripts", "client-scripts"],
  ["counter-utils", "client-scripts/counter-utils"],
  // Merges into existing top-level dirs
  ["content-reference", "content/content-reference"],
  ["content", "content"],
  ["onboarding-yaml", "onboarding"],
  // Loose files grouped into new domains
  ["check-hints", "checks/check-hints"],
  ["runtime-context", "runtime/runtime-context"],
  ["shared-context", "runtime/shared-context"],
  ["rfc0042-utils", "sections/rfc0042-utils"],
  ["walk-files", "stack/walk-files"],
  ["run-tool", "stack/run-tool"],
  ["stack-checks", "stack/stack-checks"],
  ["attribution-display", "attribution/attribution-display"],
  ["material-credits", "attribution/material-credits"],
  ["offer-capacity", "offers/offer-capacity"],
  ["formula-eval", "offers/formula-eval"],
  ["string-utils", "text/string-utils"],
  ["text-normalize", "text/text-normalize"],
  ["text-position", "text/text-position"],
  ["wrap-inline-numbers", "text/wrap-inline-numbers"],
  ["css-value-normalize", "text/css-value-normalize"],
  ["entitlement", "policy/entitlement"],
  ["feature-policy", "policy/feature-policy"],
  ["visibility", "policy/visibility"],
  ["page", "page"],
  ["redirects", "redirects"],
  ["image-provider", "image-provider"],
];

/** Domain dirs promoted mechanically: `share/<name>` → `<name>`. */
const PROMOTED_DIRS = new Set([
  "agent",
  "content-discipline",
  "i18n",
  "knowledge",
  "legal",
  "middleware",
  "pbt",
  "remediation",
  "routes",
  "schemas",
  "semantic",
  "slug",
  "typography",
  "types",
]);

/**
 * Maps a `share/…` subpath (without the leading `share/`) to its new subpath,
 * or null when no mechanical target exists (bare barrel, tests, configs).
 */
export function mapShareSubpath(subpath: string): string | null {
  if (subpath === "" || subpath === "index") return null;
  // Test files, configs and type-declaration helpers are not exported post-move.
  if (
    subpath.startsWith("tests/") ||
    subpath.endsWith(".test") ||
    subpath.endsWith(".pbt.test") ||
    subpath.endsWith(".snapshot.test") ||
    subpath === "vitest.config" ||
    subpath === "env.d"
  ) {
    return null;
  }

  for (const [from, to] of EXPLICIT_MAP) {
    if (subpath === from) return to;
    if (subpath.startsWith(`${from}/`)) return to + subpath.slice(from.length);
  }

  const first = subpath.split("/")[0];
  if (first !== undefined && PROMOTED_DIRS.has(first)) {
    // Normalize trailing `/index` to the canonical barrel subpath.
    return subpath.endsWith("/index") ? subpath.slice(0, -"/index".length) : subpath;
  }

  return null;
}

async function collectFiles(dir: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) await collectFiles(path.join(dir, entry.name), out);
    } else if (entry.isFile() && SCAN_EXTENSIONS.has(path.extname(entry.name))) {
      out.push(path.join(dir, entry.name));
    }
  }
}

async function rewriteFile(filePath: string, ctx: MigrationContext): Promise<boolean> {
  let content: string;
  try {
    content = await fs.readFile(filePath, "utf-8");
  } catch {
    return false;
  }
  if (!content.includes("werkstatt-shared/share")) return false;

  let unresolved = 0;
  const rewritten = content.replace(SPECIFIER_RE, (match, sub: string | undefined) => {
    const subpath = (sub ?? "").replace(/^\//, "");
    const mapped = mapShareSubpath(subpath);
    if (mapped === null) {
      unresolved += 1;
      return match;
    }
    return `@warpgogol/werkstatt-shared/${mapped}`;
  });

  if (unresolved > 0) {
    ctx.logger.info(
      `[rfc-1105] WARNING ${filePath}: ${unresolved} share specifier(s) have no mechanical target ` +
        `(bare barrel, tests, or configs) — repair manually`,
    );
  }
  if (rewritten === content) return false;

  await fs.writeFile(filePath, rewritten, "utf-8");
  return true;
}

export const rfc1105Migrator: Migrator = {
  id: RFC_1105_MIGRATOR_ID,
  fromVersion: "6.230.0",
  toVersion: "6.231.0",
  description:
    "Rewrite `@warpgogol/werkstatt-shared/share/X` specifiers to post-dissolution top-level subpaths in workpiece authored sources (RFC-1105 share namespace dissolution). Bare barrel and test/config specifiers are logged for manual repair.",
  transform: async (data: SternsystemData, ctx: MigrationContext) => {
    const files: string[] = [];
    await collectFiles(path.join(data.rootPath, "src"), files);
    // Root-level config files can also carry specifiers (astro.config.mjs, etc.).
    let rootEntries: import("node:fs").Dirent[] = [];
    try {
      rootEntries = await fs.readdir(data.rootPath, { withFileTypes: true });
    } catch {
      rootEntries = [];
    }
    for (const entry of rootEntries) {
      if (entry.isFile() && SCAN_EXTENSIONS.has(path.extname(entry.name))) {
        files.push(path.join(data.rootPath, entry.name));
      }
    }

    let rewritten = 0;
    for (const file of files) {
      if (await rewriteFile(file, ctx)) rewritten += 1;
    }
    ctx.logger.info(
      `[rfc-1105] share-path-rewrite: ${rewritten} file(s) rewritten, ${files.length} scanned`,
    );
    return data;
  },
};
