/*
<MODULE_CONTRACT>
<purpose>RFC-0480: surface.contract.validate — validate generated C-surfaces against declarative contract.</purpose>
<non-goals>
  <item>Does not generate C-surfaces — only validates them against the contract.</item>
  <item>Does not modify the contract — contracts are declarative in @warpgogol/werkstatt-shared/ontology/external-surfaces.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0480: initial surface.contract.validate command handler.</item>
  <item>RFC-0498: add per-depth JSON-LD type policy checks — verify surfacePolicy is present and no required/prohibited overlap.</item>
  <item>RFC-0499: add mediaLeakagePolicy checks — verify policy is present and structurally valid.</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import {
  urlSchema,
  jsonldTypes,
  sitemapShape,
} from "@warpgogol/werkstatt-shared/ontology/external-surfaces";
import { resolveCacheClonePath } from "../sternsystem/registry-io.ts";

export interface SurfaceContractValidateData {
  systemId: string | null;
  violations: Array<{ surface: string; rule: string; message: string }>;
  validatedSurfaces: string[];
}

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

export async function runSurfaceContractValidate(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<SurfaceContractValidateData>> {
  const { workspaceRoot, logger } = context;
  const systemId = flagString(input, "app") ?? null;

  const violations: Array<{ surface: string; rule: string; message: string }> = [];
  const validatedSurfaces: string[] = [];

  // Determine the site directory to validate
  let siteDir: string;
  if (systemId) {
    siteDir = await resolveCacheClonePath(workspaceRoot, systemId);
  } else {
    // Default: validate the first active system or the workspace root
    siteDir = workspaceRoot;
  }

  // 1. Validate URL patterns against route registry
  const routeRegistryPath = path.join(siteDir, "src", "surface.generated.json");
  const routesPath = path.join(siteDir, "src", "content", "routes.yaml");

  if (existsSync(routeRegistryPath)) {
    try {
      const raw = await fs.readFile(routeRegistryPath, "utf8");
      const routes = JSON.parse(raw) as Array<{ pattern?: string; path?: string }>;
      const contractPatterns = urlSchema.routePatterns.map((p) => p.pattern);

      for (const route of routes) {
        const routePath = route.path ?? route.pattern;
        if (!routePath) continue;

        // Check if route matches any contract pattern
        const matches = contractPatterns.some((pattern) => {
          const regex = patternToRegex(pattern);
          return regex.test(routePath);
        });

        if (!matches) {
          violations.push({
            surface: "url-schema",
            rule: "unmatched-route",
            message: `Route '${routePath}' does not match any pattern in url-schema.yaml`,
          });
        }
      }
      validatedSurfaces.push("url-schema");
    } catch (err) {
      violations.push({
        surface: "url-schema",
        rule: "parse-error",
        message: `Failed to parse surface.generated.json: ${(err as Error).message}`,
      });
    }
  } else if (existsSync(routesPath)) {
    // Fallback: check routes.yaml if surface.generated.json doesn't exist
    validatedSurfaces.push("url-schema (routes.yaml)");
  } else {
    // No routes — empty system, no violations
    validatedSurfaces.push("url-schema (empty)");
  }

  // 2. Validate JSON-LD types
  // Check that any JSON-LD templates use only declared @type values
  const contentDir = path.join(siteDir, "src", "content");
  if (existsSync(contentDir)) {
    const declaredTypes = new Set(jsonldTypes.types.map((t) => t["@type"]));
    // This is a lightweight check — full validation would scan all pages
    // For now, just verify the contract is loadable and types are declared
    if (declaredTypes.size > 0) {
      validatedSurfaces.push("jsonld-types");
    } else {
      violations.push({
        surface: "jsonld-types",
        rule: "empty-types",
        message: `jsonld-types.yaml declares no types`,
      });
    }
  } else {
    validatedSurfaces.push("jsonld-types (empty)");
  }

  // RFC-0498: Validate surfacePolicy section in the C-contract.
  if (jsonldTypes.surfacePolicy && jsonldTypes.surfacePolicy.length > 0) {
    for (const entry of jsonldTypes.surfacePolicy) {
      const requiredSet = new Set(entry.requiredTypes);
      const prohibitedSet = new Set(entry.prohibitedTypes);
      const overlap = [...requiredSet].filter((t) => prohibitedSet.has(t));
      if (overlap.length > 0) {
        violations.push({
          surface: "jsonld-types",
          rule: "jsonld-surface-policy-overlap",
          message: `surfacePolicy entry (${entry.surface} depth-${entry.depth}) has overlapping required and prohibited types: ${overlap.join(", ")}`,
        });
      }
    }
    validatedSurfaces.push("jsonld-surface-policy");
  } else {
    violations.push({
      surface: "jsonld-types",
      rule: "jsonld-surface-policy-missing",
      message: `jsonld-types.yaml has no surfacePolicy section — required by RFC-0498`,
    });
  }

  // RFC-0506: Validate ratgeber depth-1 Article field policy in the C-contract.
  const articleType = jsonldTypes.types.find((t) => t["@type"] === "Article");
  if (articleType) {
    const optionalFields = new Set(articleType.optional);
    if (!optionalFields.has("description")) {
      violations.push({
        surface: "jsonld-types",
        rule: "jsonld-article-field-missing",
        message: `Article type optional fields must include "description" — required by RFC-0506`,
      });
    }
    if (!optionalFields.has("mainEntityOfPage")) {
      violations.push({
        surface: "jsonld-types",
        rule: "jsonld-article-field-missing",
        message: `Article type optional fields must include "mainEntityOfPage" — required by RFC-0506`,
      });
    }
  }
  const ratgeberDepth1Policy = jsonldTypes.surfacePolicy?.find(
    (p) => p.surface === "ratgeber" && p.depth === 1,
  );
  if (ratgeberDepth1Policy) {
    if (!ratgeberDepth1Policy.prohibitedTypes.includes("FAQPage")) {
      violations.push({
        surface: "jsonld-types",
        rule: "jsonld-surface-policy-missing",
        message: `ratgeber depth-1 prohibitedTypes must include "FAQPage" — required by RFC-0506`,
      });
    }
  }

  // RFC-0499: Validate mediaLeakagePolicy section in the C-contract.
  if (jsonldTypes.mediaLeakagePolicy) {
    const policy = jsonldTypes.mediaLeakagePolicy;
    if (policy.prohibitedStrings.length === 0) {
      violations.push({
        surface: "jsonld-types",
        rule: "media-leakage-policy-empty",
        message: `mediaLeakagePolicy has no prohibitedStrings — required by RFC-0499`,
      });
    }
    if (policy.requiredLabels.length === 0) {
      violations.push({
        surface: "jsonld-types",
        rule: "media-leakage-policy-no-labels",
        message: `mediaLeakagePolicy has no requiredLabels — required by RFC-0499`,
      });
    }
    if (!policy.requiredLinkPattern) {
      violations.push({
        surface: "jsonld-types",
        rule: "media-leakage-policy-no-link-pattern",
        message: `mediaLeakagePolicy has no requiredLinkPattern — required by RFC-0499`,
      });
    }
    if (!policy.aiImageAttribute) {
      violations.push({
        surface: "jsonld-types",
        rule: "media-leakage-policy-no-ai-attribute",
        message: `mediaLeakagePolicy has no aiImageAttribute — required by RFC-0499`,
      });
    }
    validatedSurfaces.push("jsonld-media-leakage-policy");
  } else {
    violations.push({
      surface: "jsonld-types",
      rule: "media-leakage-policy-missing",
      message: `jsonld-types.yaml has no mediaLeakagePolicy section — required by RFC-0499`,
    });
  }

  // 3. Validate sitemap shape
  // Check that sitemap.xml (if exists) conforms to the declared shape
  const sitemapPath = path.join(siteDir, "dist", "sitemap.xml");
  if (existsSync(sitemapPath)) {
    try {
      const raw = await fs.readFile(sitemapPath, "utf8");
      const requiredFields = sitemapShape.urlEntry.required;
      const hasLoc = raw.includes("<loc>");
      if (requiredFields.includes("loc") && !hasLoc) {
        violations.push({
          surface: "sitemap-shape",
          rule: "missing-loc",
          message: `sitemap.xml does not contain required <loc> elements`,
        });
      }
      validatedSurfaces.push("sitemap-shape");
    } catch (err) {
      violations.push({
        surface: "sitemap-shape",
        rule: "parse-error",
        message: `Failed to parse sitemap.xml: ${(err as Error).message}`,
      });
    }
  } else {
    // No sitemap — empty system or not built yet
    validatedSurfaces.push("sitemap-shape (empty)");
  }

  if (violations.length === 0) {
    logger.success(
      `[surface.contract.validate] ${validatedSurfaces.length} surface(s) validated, 0 violations`,
    );
  } else {
    logger.error(
      `[surface.contract.validate] ${validatedSurfaces.length} surface(s) validated, ${violations.length} violation${violations.length === 1 ? "" : "s"}`,
    );
    for (const v of violations) {
      logger.error(`  [${v.rule}] ${v.surface}: ${v.message}`);
    }
  }

  return {
    data: { systemId, violations, validatedSurfaces },
    exitCode: violations.length > 0 ? 1 : 0,
    summary: `[surface.contract.validate] ${validatedSurfaces.length} surface(s) validated, ${violations.length} violation${violations.length === 1 ? "" : "s"}`,
  };
}

function patternToRegex(pattern: string): RegExp {
  // Convert URL pattern like "/:locale?/:slug" to a regex
  let regex = pattern.replace(/:locale\?/g, "(?:[a-z]{2}/)?");
  regex = regex.replace(/:([a-zA-Z]+)/g, "([^/]+)");
  regex = `^${regex}$`;
  return new RegExp(regex);
}
