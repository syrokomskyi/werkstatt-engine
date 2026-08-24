/*
<MODULE_CONTRACT>
<purpose>Maintains packages/ontology/src/operations/materialization.ts as an authored ontology authored module so agents can evolve it without rediscovering local boundaries.</purpose>
<non-goals>
  <item>Does not define mission lifecycle — that is RFC-0355.</item>
  <item>Does not define release discipline — that is RFC-0357.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0356: initial materialization report schemas.</item>
</CHANGE_SUMMARY>
*/

import { z } from "zod";

export const materializationReportSchema = z.object({
  schemaVersion: z.string().min(1),
  missionId: z.string().min(1),
  systemId: z.string().min(1),
  versionComparison: z.object({
    verdict: z.enum(["in-sync", "catch-up", "refuse-downgrade"]),
    pinVersion: z.string(),
    platformVersion: z.string(),
    packagesDrift: z.boolean(),
    message: z.string(),
  }),
  migratorChain: z.array(
    z.object({
      fromVersion: z.string(),
      toVersion: z.string(),
      rfc: z.string(),
      applied: z.boolean(),
    }),
  ),
  capabilityDiff: z.object({
    tier: z.enum(["green", "yellow", "red"]),
    items: z.array(
      z.object({
        semanticId: z.string(),
        status: z.enum(["unchanged", "additive", "renamed-or-bumped", "removed"]),
        tier: z.enum(["green", "yellow", "red"]),
        resolution: z.string().nullable(),
      }),
    ),
  }),
  regeneration: z.object({
    regeneratedFiles: z.array(z.string()),
    success: z.boolean(),
  }),
  materializedAt: z.string().datetime(),
});

export const validationReportSchema = z.object({
  schemaVersion: z.string().min(1),
  missionId: z.string().min(1),
  contractFull: z.object({
    passed: z.boolean(),
    validators: z.array(
      z.object({
        name: z.string(),
        status: z.enum(["pass", "fail"]),
        diagnostics: z.array(
          z.object({
            ruleId: z.string(),
            severity: z.string(),
            message: z.string(),
          }),
        ),
      }),
    ),
  }),
  build: z.object({
    succeeded: z.boolean(),
    routeCount: z.number(),
    sitemapHash: z.string(),
  }),
  validatedAt: z.string().datetime(),
});

export const authoredDiffSchema = z.object({
  schemaVersion: z.string().min(1),
  missionId: z.string().min(1),
  added: z.array(z.string()),
  modified: z.array(z.string()),
  removed: z.array(z.string()),
});

export type MaterializationReport = z.infer<typeof materializationReportSchema>;
export type ValidationReport = z.infer<typeof validationReportSchema>;
export type AuthoredDiff = z.infer<typeof authoredDiffSchema>;
