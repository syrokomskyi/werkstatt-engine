/*
<MODULE_CONTRACT>
<purpose>RFC-0221: the golden validation pack — capture a site's significant properties (route list,
sitemap hash, llms hashes, passport scores) from a build output, and diff a freshly built pack against
the bundle's golden one so absorb can confirm the catch-up preserved them.</purpose>
<non-goals>
  <item>Do not build the site — operate on an existing build output.</item>
  <item>Do not capture DOM/screenshots — structural facts only (advisory visuals are out of scope).</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0221: golden validation pack emit + diff.</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import path from "node:path";
import { sha256OfBytes } from "./bundle-io.ts";

export interface ValidationPack {
  /** Output-relative POSIX paths of rendered HTML routes, sorted. */
  routes: string[];
  /** sha256 of sitemap.xml, or null when absent. */
  sitemapHash: string | null;
  /** filename → sha256 for llms.txt / llms-full.txt. */
  llmsHashes: Record<string, string>;
  /** Passport nebula score + per-pillar scores, or null when no passport was emitted. */
  scores: { nebula: number; pillars: Record<string, number> } | null;
  /** True when no build output was found (pack is empty/non-authoritative). */
  empty: boolean;
}

export interface ValidationDiff {
  routesAdded: string[];
  routesRemoved: string[];
  sitemapChanged: boolean;
  llmsChanged: string[];
  scoreDeltas: { key: string; from: number | null; to: number | null }[];
  /** True when nothing of significance changed. */
  clean: boolean;
}

const LLMS_FILES = ["llms.txt", "llms-full.txt"];

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

/** The directory that holds the served site (Cloudflare adapter → dist/client; else dist). */
async function resolveOutputDir(appDir: string): Promise<string | null> {
  const client = path.join(appDir, "dist", "client");
  if (await exists(client)) return client;
  const dist = path.join(appDir, "dist");
  if (await exists(dist)) return dist;
  return null;
}

async function walkHtml(root: string): Promise<string[]> {
  const out: string[] = [];
  async function rec(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "_astro" || e.name === "_img" || e.name === "_video") continue;
        await rec(abs);
      } else if (e.name.endsWith(".html")) {
        out.push(path.relative(root, abs).replace(/\\/g, "/"));
      }
    }
  }
  await rec(root);
  return out.sort();
}

async function hashIfExists(p: string): Promise<string | null> {
  try {
    return sha256OfBytes(await fs.readFile(p));
  } catch {
    return null;
  }
}

async function readScores(outDir: string, appDir: string): Promise<ValidationPack["scores"]> {
  for (const candidate of [
    path.join(outDir, ".well-known", "cosmic-passport.json"),
    path.join(appDir, "dist", ".well-known", "cosmic-passport.json"),
  ]) {
    try {
      const raw = await fs.readFile(candidate, "utf8");
      const parsed = JSON.parse(raw) as {
        scores?: { nebula?: number; pillars?: Record<string, { score?: number }> };
      };
      if (!parsed.scores) continue;
      const pillars: Record<string, number> = {};
      for (const [k, v] of Object.entries(parsed.scores.pillars ?? {})) {
        if (typeof v?.score === "number") pillars[k] = v.score;
      }
      return { nebula: parsed.scores.nebula ?? 0, pillars };
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

/** Read the significant properties of an app's current build output into a ValidationPack. */
export async function buildValidationPack(appDir: string): Promise<ValidationPack> {
  const outDir = await resolveOutputDir(appDir);
  if (!outDir) {
    return { routes: [], sitemapHash: null, llmsHashes: {}, scores: null, empty: true };
  }
  const routes = await walkHtml(outDir);
  const sitemapHash = await hashIfExists(path.join(outDir, "sitemap.xml"));
  const llmsHashes: Record<string, string> = {};
  for (const name of LLMS_FILES) {
    const h = await hashIfExists(path.join(outDir, name));
    if (h) llmsHashes[name] = h;
  }
  const scores = await readScores(outDir, appDir);
  return { routes, sitemapHash, llmsHashes, scores, empty: false };
}

function diffStringSets(a: string[], b: string[]): { added: string[]; removed: string[] } {
  const setA = new Set(a);
  const setB = new Set(b);
  return {
    added: b.filter((x) => !setA.has(x)).sort(),
    removed: a.filter((x) => !setB.has(x)).sort(),
  };
}

/** Diff a freshly built pack (`fresh`) against the bundle's golden pack (`golden`). */
export function diffValidationPacks(golden: ValidationPack, fresh: ValidationPack): ValidationDiff {
  const routes = diffStringSets(golden.routes, fresh.routes);

  const llmsChanged: string[] = [];
  const keys = new Set([...Object.keys(golden.llmsHashes), ...Object.keys(fresh.llmsHashes)]);
  for (const k of keys) {
    if (golden.llmsHashes[k] !== fresh.llmsHashes[k]) llmsChanged.push(k);
  }
  llmsChanged.sort();

  const scoreDeltas: ValidationDiff["scoreDeltas"] = [];
  const gScores = golden.scores;
  const fScores = fresh.scores;
  if (gScores || fScores) {
    if ((gScores?.nebula ?? null) !== (fScores?.nebula ?? null)) {
      scoreDeltas.push({
        key: "nebula",
        from: gScores?.nebula ?? null,
        to: fScores?.nebula ?? null,
      });
    }
    const pillarKeys = new Set([
      ...Object.keys(gScores?.pillars ?? {}),
      ...Object.keys(fScores?.pillars ?? {}),
    ]);
    for (const k of pillarKeys) {
      const from = gScores?.pillars[k] ?? null;
      const to = fScores?.pillars[k] ?? null;
      if (from !== to) scoreDeltas.push({ key: `pillar.${k}`, from, to });
    }
  }

  const sitemapChanged = golden.sitemapHash !== fresh.sitemapHash;
  const clean =
    routes.added.length === 0 &&
    routes.removed.length === 0 &&
    !sitemapChanged &&
    llmsChanged.length === 0 &&
    scoreDeltas.length === 0;

  return {
    routesAdded: routes.added,
    routesRemoved: routes.removed,
    sitemapChanged,
    llmsChanged,
    scoreDeltas,
    clean,
  };
}
