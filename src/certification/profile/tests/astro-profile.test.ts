import { describe, it, expect } from "vitest";
import { astroCertificationProfile } from "../astro-profile.ts";
import { certificationProfileV1Schema } from "../schemas.ts";
import { validateCertificationProfileV1 } from "../validate.ts";

describe("astroCertificationProfile", () => {
  it("passes schema validation", () => {
    const result = certificationProfileV1Schema.safeParse(astroCertificationProfile);
    expect(result.success).toBe(true);
  });

  it("has correct plugin binding", () => {
    expect(astroCertificationProfile.plugin.id).toBe("werkstatt-site");
    expect(astroCertificationProfile.plugin.profileId).toBe("astro-typescript-turborepo");
  });

  it("covers all 9 site quality dimensions", () => {
    expect(astroCertificationProfile.dimensions).toHaveLength(9);
    expect(astroCertificationProfile.dimensions).toContain("candidate-integrity");
    expect(astroCertificationProfile.dimensions).toContain("business-truth-compliance");
    expect(astroCertificationProfile.dimensions).toContain("editorial-localization");
    expect(astroCertificationProfile.dimensions).toContain("information-architecture-discoverability");
    expect(astroCertificationProfile.dimensions).toContain("ux-conversion");
    expect(astroCertificationProfile.dimensions).toContain("visual-accessibility");
    expect(astroCertificationProfile.dimensions).toContain("performance-runtime");
    expect(astroCertificationProfile.dimensions).toContain("security-operational-readiness");
    expect(astroCertificationProfile.dimensions).toContain("independent-qualitative-evaluation");
  });

  it("has 9 requirements with promote-main gate", () => {
    expect(astroCertificationProfile.requirements).toHaveLength(9);
    for (const req of astroCertificationProfile.requirements) {
      expect(req.gates).toContain("promote-main");
      expect(req.classification).toBe("required");
    }
  });

  it("has at least one producer", () => {
    const producerIds = Object.keys(astroCertificationProfile.producers);
    expect(producerIds.length).toBeGreaterThanOrEqual(1);
    expect(astroCertificationProfile.producers["astro-mission-check"]).toBeDefined();
  });

  it("passes validateCertificationProfileV1 with matching context", () => {
    const ctx = {
      pluginId: "werkstatt-site",
      profileId: "astro-typescript-turborepo",
      registeredCommands: new Set(["mission.check"]),
    };
    const result = validateCertificationProfileV1(astroCertificationProfile, ctx);
    expect(result.valid).toBe(true);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("fails validation when plugin id does not match", () => {
    const ctx = {
      pluginId: "wrong-plugin",
      profileId: "astro-typescript-turborepo",
      registeredCommands: new Set(["mission.check"]),
    };
    const result = validateCertificationProfileV1(astroCertificationProfile, ctx);
    expect(result.valid).toBe(false);
    expect(result.diagnostics.some((d) => d.ruleId === "CERT-PROFILE-02")).toBe(true);
  });

  it("has valid retention policy", () => {
    const rp = astroCertificationProfile.retentionPolicy;
    expect(rp.minRetentionDays).toBeLessThanOrEqual(rp.maxRetentionDays);
  });
});
