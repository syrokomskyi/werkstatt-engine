/*
<MODULE_CONTRACT>
  <purpose>RFC-1295: certify producer wiring — the editorial-localization requirement is produced by editorial-signoff (editorial.review.verify), and the derived producer node set covers both producers.</purpose>
  <keywords>RFC-1295, leitstand, certify, editorial-signoff, producer, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1295: initial test — profile requirement→producer binding + derived producer-node set.</item>
  <item>RFC-1295</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import { astroCertificationProfile } from "../../certification/profile/astro-profile.ts";
import type { ProducerDependencyNodeV1 } from "../../certification/orchestration/orchestrator.ts";

test("editorial-localization requirement uses the editorial-signoff producer", () => {
  const req = astroCertificationProfile.requirements.find(
    (r) => r.dimension === "editorial-localization",
  );
  expect(req).toBeDefined();
  expect(req!.producerId).toBe("editorial-signoff");
  expect(req!.gates).toEqual(["promote-main"]);
  // RFC-1295 spec says "reuses nothing" — encoded as environmentIndependent:
  // false + empty allowedFrom (environmentIndependent + empty allowedFrom is
  // rejected by CERT-PROFILE-06).
  expect(req!.reuse.environmentIndependent).toBe(false);
  expect(req!.reuse.allowedFrom).toEqual([]);
  expect(req!.remediation.reproduceCommand).toContain("editorial.review.prepare");
  expect(req!.remediation.verificationCommand).toContain("editorial.review.verify");
});

test("profile declares the editorial-signoff producer bound to editorial.review.verify", () => {
  const producer = astroCertificationProfile.producers["editorial-signoff"];
  expect(producer).toBeDefined();
  expect(producer.kind).toBe("kernel-command");
  expect(producer.command).toBe("editorial.review.verify");
  expect(producer.requiredPayloadRoles).toContain("check-result");
});

test("producer node derivation covers every requirement's producerId", () => {
  // Mirrors the certify.ts derivation — the plan source is the requirement
  // set's unique producerIds, never a hardcoded node list.
  const nodes: ProducerDependencyNodeV1[] = [
    ...new Set(astroCertificationProfile.requirements.map((r) => r.producerId)),
  ].map((producerId) => ({ producerId, dependsOn: [] }));
  const ids = nodes.map((n) => n.producerId);
  expect(ids).toContain("astro-mission-check");
  expect(ids).toContain("editorial-signoff");
  for (const req of astroCertificationProfile.requirements) {
    expect(ids).toContain(req.producerId);
    expect(astroCertificationProfile.producers[req.producerId]).toBeDefined();
  }
});
