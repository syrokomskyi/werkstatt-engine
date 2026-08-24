import type { CertificationProfileV1, SiteQualityDimension, CertificationRequirementV1 } from "./schemas.ts";

export interface ProfileValidationDiagnostic {
  ruleId: string;
  severity: "error";
  message: string;
}

export interface ProfileValidationResultV1 {
  valid: boolean;
  diagnostics: ProfileValidationDiagnostic[];
  dimensionCoverage: Array<{
    dimension: SiteQualityDimension | "core";
    hasMainRequired: boolean;
    requirementIds: string[];
  }>;
}

const ALL_DIMENSIONS: SiteQualityDimension[] = [
  "candidate-integrity",
  "business-truth-compliance",
  "editorial-localization",
  "information-architecture-discoverability",
  "ux-conversion",
  "visual-accessibility",
  "performance-runtime",
  "security-operational-readiness",
  "independent-qualitative-evaluation",
];

export interface ProfileValidationContextV1 {
  pluginId: string;
  profileId: string;
  registeredCommands: Set<string>;
}

export function validateCertificationProfileV1(
  profile: CertificationProfileV1,
  ctx: ProfileValidationContextV1,
): ProfileValidationResultV1 {
  const diagnostics: ProfileValidationDiagnostic[] = [];

  if (profile.plugin.id !== ctx.pluginId) {
    diagnostics.push({
      ruleId: "CERT-PROFILE-02",
      severity: "error",
      message: `plugin.id "${profile.plugin.id}" does not match active plugin "${ctx.pluginId}"`,
    });
  }

  if (profile.plugin.profileId !== ctx.profileId) {
    diagnostics.push({
      ruleId: "CERT-PROFILE-02",
      severity: "error",
      message: `plugin.profileId "${profile.plugin.profileId}" does not match forge.yaml profile "${ctx.profileId}"`,
    });
  }

  const requirementIds = new Set<string>();
  for (const req of profile.requirements) {
    if (requirementIds.has(req.id)) {
      diagnostics.push({
        ruleId: "CERT-PROFILE-03",
        severity: "error",
        message: `duplicate requirement ID "${req.id}"`,
      });
    }
    requirementIds.add(req.id);
  }

  const producerIds = new Set<string>();
  for (const [id, producer] of Object.entries(profile.producers)) {
    if (producerIds.has(id)) {
      diagnostics.push({
        ruleId: "CERT-PROFILE-03",
        severity: "error",
        message: `duplicate producer ID "${id}"`,
      });
    }
    producerIds.add(id);

    if (producer.kind === "kernel-command" && producer.command) {
      if (!ctx.registeredCommands.has(producer.command)) {
        diagnostics.push({
          ruleId: "CERT-PROFILE-04",
          severity: "error",
          message: `producer "${id}" references unregistered command "${producer.command}"`,
        });
      }
    }
  }

  for (const req of profile.requirements) {
    if (req.classification === "required" || req.classification === "conditional") {
      if (!profile.producers[req.producerId]) {
        diagnostics.push({
          ruleId: "CERT-PROFILE-05",
          severity: "error",
          message: `requirement "${req.id}" references missing producer "${req.producerId}"`,
        });
      }
    }

    if (req.classification === "advisory" && !profile.producers[req.producerId]) {
      diagnostics.push({
        ruleId: "CERT-PROFILE-05",
        severity: "error",
        message: `advisory requirement "${req.id}" references missing producer "${req.producerId}"`,
      });
    }

    if (req.reuse.environmentIndependent) {
      const allowedSet = new Set(req.reuse.allowedFrom);
      if (allowedSet.size === 0) {
        diagnostics.push({
          ruleId: "CERT-PROFILE-06",
          severity: "error",
          message: `requirement "${req.id}" declares environmentIndependent but has empty allowedFrom`,
        });
      }
    }

    if (req.normativeRefs.length === 0) {
      diagnostics.push({
        ruleId: "CERT-PROFILE-07",
        severity: "error",
        message: `requirement "${req.id}" has no normative reference`,
      });
    }

    if (req.remediation.reproduceCommand.length === 0) {
      diagnostics.push({
        ruleId: "CERT-PROFILE-07",
        severity: "error",
        message: `requirement "${req.id}" has empty reproduceCommand`,
      });
    }

    if (req.driftAction === "rollback" && req.classification !== "required") {
      diagnostics.push({
        ruleId: "CERT-PROFILE-08",
        severity: "error",
        message: `requirement "${req.id}" has rollback driftAction but is not required classification`,
      });
    }

    if (req.gates.includes("continuous-health")) {
      if (req.freshness.maxAgeSeconds === null && !req.freshness.schedule) {
        diagnostics.push({
          ruleId: "CERT-PROFILE-09",
          severity: "error",
          message: `continuous-health requirement "${req.id}" has no freshness TTL or schedule`,
        });
      }
    }
  }

  const dimensionCoverage = computeDimensionCoverage(profile.requirements);
  for (const dim of ALL_DIMENSIONS) {
    const entry = dimensionCoverage.find((d) => d.dimension === dim);
    if (!entry || !entry.hasMainRequired) {
      diagnostics.push({
        ruleId: "CERT-PROFILE-10",
        severity: "error",
        message: `dimension "${dim}" lacks a Main required/conditional coverage path`,
      });
    }
  }

  if (profile.evaluatorPolicy) {
    const ep = profile.evaluatorPolicy;
    if (ep.ordinaryEvaluators < 1) {
      diagnostics.push({
        ruleId: "CERT-PROFILE-11",
        severity: "error",
        message: "evaluatorPolicy.ordinaryEvaluators must be at least 1",
      });
    }
    if (ep.criticalEvaluators < ep.ordinaryEvaluators) {
      diagnostics.push({
        ruleId: "CERT-PROFILE-11",
        severity: "error",
        message: "evaluatorPolicy.criticalEvaluators must be >= ordinaryEvaluators",
      });
    }
  }

  return {
    valid: diagnostics.length === 0,
    diagnostics,
    dimensionCoverage,
  };
}

function computeDimensionCoverage(
  requirements: CertificationRequirementV1[],
): Array<{
  dimension: SiteQualityDimension | "core";
  hasMainRequired: boolean;
  requirementIds: string[];
}> {
  const map = new Map<string, { hasMainRequired: boolean; requirementIds: string[] }>();

  for (const req of requirements) {
    const existing = map.get(req.dimension) ?? {
      hasMainRequired: false,
      requirementIds: [],
    };
    existing.requirementIds.push(req.id);
    if (
      (req.classification === "required" || req.classification === "conditional") &&
      req.gates.includes("promote-main")
    ) {
      existing.hasMainRequired = true;
    }
    map.set(req.dimension, existing);
  }

  return Array.from(map.entries()).map(([dimension, val]) => ({
    dimension: dimension as SiteQualityDimension | "core",
    ...val,
  }));
}
