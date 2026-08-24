import type {
  ComponentId,
  ComponentManifestV1,
  ResolvedComponentIdentityV1,
  ResolvedComponentSetV1,
} from "../../component/contracts.ts";
import { ComponentFiber } from "../fiber.ts";
import type { Deadline } from "../fiber.ts";
import { resolve, type ResolutionInputV1 } from "../resolver.ts";
import { computeReconciliationPlan } from "../reconciliation.ts";
import {
  createCapabilityCatalog,
  type CapabilityCatalogV1,
  type LiveComponentObservation,
} from "../reflection.ts";
import type {
  ConformanceScenarioV1,
  ConformanceExpectationV1,
  ConformanceTraceEntryV1,
  ConformanceMismatchV1,
  ConformanceResultV1,
  ConformanceCleanupReportV1,
  ReflectedLifecycleState,
} from "../conformance.ts";
import { createConformanceResult } from "../conformance.ts";
import { toReflectedState } from "../reflection.ts";

const TEST_MODE_SENTINEL = "__WERKSTATT_CONFORMANCE_TEST_MODE__";

export interface TrustedFixture {
  readonly fixtureId: string;
  readonly artifactHash: string;
  readonly trusted: true;
  readonly manifests: readonly ComponentManifestV1[];
  readonly availableArtifacts: ReadonlyMap<
    ComponentId,
    import("../../fingerprint/primitives.ts").Sha256Digest
  >;
  readonly admittedGrants: ReadonlyArray<{ scope: string; resource: string }>;
}

export interface HarnessOptions {
  readonly now: () => number;
  readonly drainDeadline: Deadline;
}

function assertTestMode(): void {
  const env = globalThis as Record<string, unknown>;
  if (env[TEST_MODE_SENTINEL] !== true) {
    throw new Error("CONFORMANCE-01: harness invoked outside test mode — refusing to load fixture");
  }
}

function assertTrustedFixture(fixture: TrustedFixture): void {
  if (!fixture.trusted) {
    throw new Error(
      `CONFORMANCE-02: fixture ${fixture.fixtureId} is not marked trusted — rejecting before import`,
    );
  }
  if (!fixture.artifactHash || !fixture.artifactHash.startsWith("sha256:")) {
    throw new Error(
      `CONFORMANCE-03: fixture ${fixture.fixtureId} has invalid or unpinned artifact hash — rejecting`,
    );
  }
}

function toTraceEntry(
  expectation: ConformanceExpectationV1,
  actual: Partial<ConformanceTraceEntryV1>,
): ConformanceTraceEntryV1 {
  return {
    kind: expectation.kind,
    componentId: expectation.componentId,
    actualState: actual.actualState,
    callable: actual.callable,
    capability: actual.capability,
    at: expectation.at,
    detail: actual.detail ?? expectation.detail,
  };
}

function compareExpectation(
  expectation: ConformanceExpectationV1,
  entry: ConformanceTraceEntryV1,
): ConformanceMismatchV1 | null {
  switch (expectation.kind) {
    case "lifecycle-state":
      if (
        expectation.expectedState !== undefined &&
        entry.actualState !== expectation.expectedState
      ) {
        return {
          expectationIndex: -1,
          kind: expectation.kind,
          componentId: expectation.componentId,
          expected: expectation.expectedState,
          actual: entry.actualState ?? "unknown",
        };
      }
      return null;
    case "capability-callable":
      if (expectation.callable !== undefined && entry.callable !== expectation.callable) {
        return {
          expectationIndex: -1,
          kind: expectation.kind,
          componentId: expectation.componentId,
          expected: String(expectation.callable),
          actual: String(entry.callable ?? false),
        };
      }
      return null;
    case "no-op":
      return null;
    case "drain-complete":
    case "quarantine":
    case "catalog-entry":
    case "catalog-hash":
    case "lifecycle-transition":
      return null;
    default:
      return null;
  }
}

export async function runConformanceScenario(
  scenario: ConformanceScenarioV1,
  fixture: TrustedFixture,
  options: HarnessOptions,
): Promise<ConformanceResultV1> {
  assertTestMode();
  assertTrustedFixture(fixture);

  if (scenario.fixtureArtifactHash !== fixture.artifactHash) {
    throw new Error(
      `CONFORMANCE-04: scenario fixture hash ${scenario.fixtureArtifactHash} does not match fixture ${fixture.artifactHash}`,
    );
  }

  const violations: string[] = [];
  const injectedFailures: string[] = [];
  const trace: ConformanceTraceEntryV1[] = [];
  const mismatches: ConformanceMismatchV1[] = [];

  const fiberMap = new Map<ComponentId, ComponentFiber>();
  const observations = new Map<ComponentId, LiveComponentObservation>();

  function recordObservation(componentId: ComponentId): void {
    const fiber = fiberMap.get(componentId);
    if (fiber) {
      observations.set(componentId, {
        componentId,
        lifecycleState: fiber.state,
      });
    }
  }

  function recordTrace(
    expectation: ConformanceExpectationV1,
    actual: Partial<ConformanceTraceEntryV1>,
  ): void {
    const entry = toTraceEntry(expectation, actual);
    trace.push(entry);
    const mismatch = compareExpectation(expectation, entry);
    if (mismatch) {
      mismatches.push({ ...mismatch, expectationIndex: trace.length - 1 });
    }
  }

  function createFiber(identity: ResolvedComponentIdentityV1): ComponentFiber {
    const fiber = new ComponentFiber(identity, "declared");
    fiberMap.set(identity.componentId, fiber);
    return fiber;
  }

  for (const identity of scenario.initialSet.components) {
    const fiber = createFiber(identity);
    fiber.transitionTo("waiting");
    fiber.transitionTo("loading");
    fiber.transitionTo("active");
    recordObservation(identity.componentId);
  }

  for (const event of scenario.injectedEvents) {
    switch (event.type) {
      case "activate": {
        if (event.componentId) {
          const fiber = fiberMap.get(event.componentId);
          if (fiber) {
            fiber.transitionTo("active");
            recordObservation(event.componentId);
          }
        }
        break;
      }
      case "drain": {
        if (event.componentId) {
          const fiber = fiberMap.get(event.componentId);
          if (fiber) {
            await fiber.drain(options.drainDeadline);
            recordObservation(event.componentId);
          }
        }
        break;
      }
      case "cancel": {
        if (event.componentId) {
          const fiber = fiberMap.get(event.componentId);
          if (fiber) {
            fiber.cancelAllOperations();
            recordObservation(event.componentId);
          }
        }
        break;
      }
      case "fail": {
        if (event.componentId) {
          const fiber = fiberMap.get(event.componentId);
          if (fiber) {
            fiber.transitionTo("failed");
            recordObservation(event.componentId);
          }
          injectedFailures.push(`${event.componentId}: ${event.detail ?? "injected failure"}`);
        }
        break;
      }
      case "quarantine": {
        if (event.componentId) {
          const fiber = fiberMap.get(event.componentId);
          if (fiber) {
            fiber.transitionTo("failed");
            fiber.transitionTo("quarantined");
            recordObservation(event.componentId);
          }
        }
        break;
      }
      case "reconcile": {
        const resolutionInput: ResolutionInputV1 = {
          profileId: scenario.desiredSet.profileId,
          desired: fixture.manifests as readonly ComponentManifestV1[],
          availableArtifacts: {
            artifacts: fixture.availableArtifacts,
          },
          admittedGrants: {
            admitted: fixture.admittedGrants,
          },
          effectPolicyHash: scenario.desiredSet.effectPolicyHash,
          isolationPolicyHash: scenario.desiredSet.isolationPolicyHash,
        };
        const resolution = resolve(resolutionInput);
        if (resolution.status === "blocked") {
          for (const v of resolution.violations) {
            violations.push(`${v.code}: ${v.message}`);
          }
          break;
        }

        const planResult = computeReconciliationPlan(scenario.initialSet, resolution.set);
        if ("status" in planResult && planResult.status === "no-op") {
          break;
        }
        if ("status" in planResult && planResult.status === "drift") {
          violations.push(`drift: ${planResult.message}`);
          break;
        }

        for (const id of planResult.activate) {
          const identity = resolution.set.components.find((c) => c.componentId === id);
          if (identity) {
            const fiber = createFiber(identity);
            fiber.transitionTo("waiting");
            fiber.transitionTo("loading");
            fiber.transitionTo("active");
            recordObservation(id);
          }
        }
        break;
      }
    }
  }

  for (const expectation of scenario.expectedTrace) {
    const componentId = expectation.componentId;
    let actualState: ReflectedLifecycleState | undefined;
    let callable: boolean | undefined;

    if (componentId) {
      const obs = observations.get(componentId);
      if (obs) {
        actualState = toReflectedState(obs.lifecycleState);
        callable = actualState === "active";
      }
    }

    recordTrace(expectation, {
      actualState,
      callable,
      capability: expectation.capability,
    });
  }

  const allStates = new Set<ReflectedLifecycleState>();
  for (const [, obs] of observations) {
    allStates.add(toReflectedState(obs.lifecycleState));
  }
  const terminalState: ReflectedLifecycleState | "mixed" =
    allStates.size === 1 ? (Array.from(allStates)[0] ?? "failed") : "mixed";

  const disposed: ComponentId[] = [];
  const quarantined: ComponentId[] = [];
  const failed: ComponentId[] = [];

  for (const [id, fiber] of fiberMap) {
    if (fiber.state === "disposed") {
      disposed.push(id);
    } else if (fiber.state === "quarantined") {
      quarantined.push(id);
    } else if (fiber.state === "failed") {
      failed.push(id);
    }
  }

  disposed.sort();
  quarantined.sort();
  failed.sort();

  const cleanupReport: ConformanceCleanupReportV1 = {
    disposed,
    quarantined,
    failed,
  };

  return createConformanceResult(
    scenario,
    trace,
    mismatches,
    injectedFailures,
    terminalState,
    cleanupReport,
    violations,
  );
}

export function buildCatalog(
  activeSet: ResolvedComponentSetV1,
  manifests: ReadonlyMap<ComponentId, ComponentManifestV1>,
  observations: ReadonlyMap<ComponentId, LiveComponentObservation>,
): CapabilityCatalogV1 {
  return createCapabilityCatalog({
    activeSet,
    manifests,
    observations,
  });
}

export { TEST_MODE_SENTINEL };
export type { TrustedFixture as ConformanceTrustedFixture };
