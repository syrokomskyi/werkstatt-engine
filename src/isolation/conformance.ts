/*
<MODULE_CONTRACT>
<purpose>isolation conformance — conformance fixture type definitions for isolation providers.</purpose>
<non-goals>
  <item>Do not run conformance checks — this module defines the fixtures.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

import type {
  AdversarialCaseKind,
  AdversarialCaseResultV1,
  IsolationAdapterV1,
  IsolationConformanceResultV1,
  IsolationConformanceStatus,
  IsolationPropertyEvidenceV1,
  IsolationPropertyKind,
} from "./contracts.ts";
import { REQUIRED_PROPERTIES, REJECTED_ADAPTER_TIERS } from "./contracts.ts";
import type { Sha256Digest } from "@warpgogol/werkstatt-shared/fingerprint";

export interface IsolationConformanceFixtureV1 {
  readonly fixtureId: string;
  readonly fixtureHash: Sha256Digest;
  readonly adapter: IsolationAdapterV1;
  readonly cases: readonly AdversarialCaseKind[];
}

export interface IsolationConformanceOptions {
  readonly now: () => number;
}

function checkProperties(evidence: IsolationPropertyEvidenceV1): {
  missing: IsolationPropertyKind[];
  unsupported: IsolationPropertyKind[];
} {
  const provenKinds = new Set<IsolationPropertyKind>();
  for (const prop of evidence.properties) {
    if (prop.proven) {
      provenKinds.add(prop.kind);
    }
  }
  const missing: IsolationPropertyKind[] = REQUIRED_PROPERTIES.filter((k) => !provenKinds.has(k));
  const unsupported: IsolationPropertyKind[] = [...evidence.unsupported];
  return { missing, unsupported };
}

function runCase(
  caseKind: AdversarialCaseKind,
  adapter: IsolationAdapterV1,
): AdversarialCaseResultV1 {
  if (REJECTED_ADAPTER_TIERS.has(caseKind)) {
    return {
      caseKind,
      passed: false,
      violations: [
        `ISOLATION-REJECTED: ${caseKind} — node:vm, worker_threads, and ordinary subprocesses cannot satisfy the untrusted isolation tier`,
      ],
      detail: `Adapter ${adapter.adapterId} is rejected for ${caseKind}: this tier is not a hostile-code security boundary`,
    };
  }

  const { missing, unsupported } = checkProperties(adapter.properties);
  if (missing.length > 0 || unsupported.length > 0) {
    return {
      caseKind,
      passed: false,
      violations: [
        ...missing.map((m) => `ISOLATION-INCOMPLETE: missing property ${m}`),
        ...unsupported.map((u) => `ISOLATION-INCOMPLETE: unsupported property ${u}`),
      ],
      detail: `Adapter ${adapter.adapterId} has incomplete property evidence for ${caseKind}`,
    };
  }

  return {
    caseKind,
    passed: true,
    violations: [],
    detail: `Adapter ${adapter.adapterId} passed ${caseKind}`,
  };
}

export function runIsolationConformance(
  fixture: IsolationConformanceFixtureV1,
  _options: IsolationConformanceOptions,
): IsolationConformanceResultV1 {
  const adapter = fixture.adapter;
  const { missing, unsupported } = checkProperties(adapter.properties);

  const defaultCases: readonly AdversarialCaseKind[] = [
    "filesystem-escape",
    "network-escape",
    "process-escape",
    "environment-escape",
    "credential-escape",
    "descriptor-escape",
    "resource-exhaustion",
    "workload-separation",
    "teardown",
    "crash",
    "bridge-confusion",
    "bridge-replay",
  ];

  const allCases: readonly AdversarialCaseKind[] =
    fixture.cases.length > 0 ? fixture.cases : defaultCases;

  const caseResults = allCases.map((c) => runCase(c, adapter));
  const allViolations = caseResults.flatMap((r) => r.violations);

  if (missing.length > 0 || unsupported.length > 0) {
    allViolations.push(
      ...missing.map((m) => `ISOLATION-INCOMPLETE: missing required property ${m}`),
      ...unsupported.map((u) => `ISOLATION-INCOMPLETE: unsupported property ${u}`),
    );
  }

  let status: IsolationConformanceStatus = "pass";
  if (allViolations.length > 0) {
    const hasFail = caseResults.some((r) => !r.passed);
    const hasIncomplete =
      missing.length > 0 ||
      unsupported.length > 0 ||
      caseResults.some((r) => r.violations.some((v) => v.startsWith("ISOLATION-INCOMPLETE")));
    status = hasIncomplete ? "incomplete" : hasFail ? "fail" : "fail";
  }

  return {
    schema: "werkstatt/isolation-conformance-result@1",
    adapterId: adapter.adapterId,
    propertyEvidenceHash:
      adapter.properties.properties[0]?.evidenceHash ??
      (("sha256:" + "0".repeat(64)) as Sha256Digest),
    grantSetHash: ("sha256:" + "0".repeat(64)) as Sha256Digest,
    fixtureHash: fixture.fixtureHash,
    cases: caseResults,
    violations: allViolations,
    status,
    testOnly: true,
  };
}

export function createConformanceResult(
  adapterId: string,
  propertyEvidenceHash: Sha256Digest,
  grantSetHash: Sha256Digest,
  fixtureHash: Sha256Digest,
  cases: readonly AdversarialCaseResultV1[],
  violations: readonly string[],
  status: IsolationConformanceStatus,
): IsolationConformanceResultV1 {
  return {
    schema: "werkstatt/isolation-conformance-result@1",
    adapterId,
    propertyEvidenceHash,
    grantSetHash,
    fixtureHash,
    cases,
    violations,
    status,
    testOnly: true,
  };
}
