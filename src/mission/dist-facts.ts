/**
 * <MODULE_CONTRACT>
 *   <purpose>RFC-1296: derive honest routeCount/sitemapHash from the built dist
 *            tree instead of parsing `astro build` stdout or assuming a
 *            `dist/sitemap-index.xml` layout that the Cloudflare adapter does
 *            not emit.</purpose>
 *   <role>Mission / engine</role>
 *   <consumers>mission-materialization-commands.ts (full + reuse paths)</consumers>
 *   <change_rules>
 *     <item>routeCount must always reflect actually rendered non-redirect
 *           pages — never fall back to a stdout regex.</item>
 *   </change_rules>
 * <non-goals>
  <item>Not a contract source of truth — callers depend on the module's exported API, not this file's internals.</item>
</non-goals>
</MODULE_CONTRACT>
 <CHANGE_SUMMARY>
  <item>RFC-1311: Compass header sweep — repairs pre-existing contract debt surfaced by the test-file scaffold rollout.</item>
</CHANGE_SUMMARY>
*/

import path from "node:path";

import { collectFiles } from "@warpgogol/werkstatt-shared/node/fs";
import { isHtmlRedirectPage } from "@warpgogol/werkstatt-shared/semantic";
import type { WorkspaceIO } from "@warpgogol/werkstatt-shared/kernel";
import { createDefaultIO } from "@warpgogol/werkstatt-shared/kernel";

import { byteHashFile } from "@warpgogol/werkstatt-engine/fingerprint";

export interface DistFacts {
  routeCount: number;
  sitemapHash: string;
}

const SITEMAP_CANDIDATES = [
  "client/sitemap-index.xml",
  "client/sitemap.xml",
  "sitemap-index.xml",
] as const;

/**
 * Compute dist facts from the rendered tree:
 *
 * - `routeCount` — number of non-redirect `index.html` files under
 *   `<distDir>/client` (meta-refresh stubs excluded via `isHtmlRedirectPage`).
 *   Falls back to `<distDir>` itself when no `client/` subtree exists (static
 *   adapters emit at the dist root).
 * - `sitemapHash` — sha256 of the first existing file among
 *   `client/sitemap-index.xml`, `client/sitemap.xml`, `sitemap-index.xml`;
 *   `"sha256:no-sitemap"` when none exist.
 */
export async function computeDistFacts(
  distDir: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<DistFacts> {
  const clientDir = path.join(distDir, "client");
  const htmlRoot = (await io.exists(clientDir)) ? clientDir : distDir;

  let routeCount = 0;
  try {
    const htmlFiles = (await collectFiles(htmlRoot, { extensions: [".html"] })).filter(
      (f) =>
        f.replace(/\\/g, "/").endsWith("/index.html") || f.replace(/\\/g, "/") === "index.html",
    );
    for (const file of htmlFiles) {
      try {
        const html = await io.readFile(file);
        if (!isHtmlRedirectPage(html)) routeCount += 1;
      } catch {
        // unreadable page — not a route
      }
    }
  } catch {
    // dist missing entirely — count stays 0
  }

  let sitemapHash = "sha256:no-sitemap";
  for (const rel of SITEMAP_CANDIDATES) {
    const candidate = path.join(distDir, rel);
    if (await io.exists(candidate)) {
      sitemapHash = await byteHashFile(candidate);
      break;
    }
  }

  return { routeCount, sitemapHash };
}
