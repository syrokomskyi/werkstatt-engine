import type { CapabilityId, ComponentId, ResolvedComponentSetV1 } from "../component/contracts.ts";
import type { ReflectedLifecycleState } from "./reflection.ts";
export type { ReflectedLifecycleState } from "./reflection.ts";

export type ConformanceEventType =
  "activate" | "drain" | "cancel" | "fail" | "quarantine" | "reconcile";

export interface ConformanceEventV1 {
  readonly type: ConformanceEventType;
  readonly componentId: ComponentId | null;
  readonly at: number;
  readonly detail?: string;
}

export type ConformanceExpectationKind =
  | "lifecycle-transition"
  | "lifecycle-state"
  | "capability-callable"
  | "drain-complete"
  | "quarantine"
  | "no-op"
  | "catalog-entry"
  | "catalog-hash";

export interface ConformanceExpectationV1 {
  readonly kind: ConformanceExpectationKind;
  readonly componentId: ComponentId | null;
  readonly expectedState?: ReflectedLifecycleState;
  readonly callable?: boolean;
  readonly capability?: CapabilityId;
  readonly at: number;
  readonly detail?: string;
}

export interface ConformanceScenarioV1 {
  readonly scenarioId: string;
  readonly fixtureArtifactHash: string;
  readonly fixtureTrusted: boolean;
  readonly initialSet: ResolvedComponentSetV1;
  readonly desiredSet: ResolvedComponentSetV1;
  readonly injectedEvents: readonly ConformanceEventV1[];
  readonly expectedTrace: readonly ConformanceExpectationV1[];
}

export interface ConformanceTraceEntryV1 {
  readonly kind: ConformanceExpectationKind;
  readonly componentId: ComponentId | null;
  readonly actualState?: ReflectedLifecycleState;
  readonly callable?: boolean;
  readonly capability?: CapabilityId;
  readonly at: number;
  readonly detail?: string;
}

export interface ConformanceMismatchV1 {
  readonly expectationIndex: number;
  readonly kind: ConformanceExpectationKind;
  readonly componentId: ComponentId | null;
  readonly expected: string;
  readonly actual: string;
}

export interface ConformanceCleanupReportV1 {
  readonly disposed: readonly ComponentId[];
  readonly quarantined: readonly ComponentId[];
  readonly failed: readonly ComponentId[];
}

export interface ConformanceResultV1 {
  readonly schema: "werkstatt/conformance-result@1";
  readonly scenarioId: string;
  readonly fixtureArtifactHash: string;
  readonly initialSetHash: string;
  readonly desiredSetHash: string;
  readonly trace: readonly ConformanceTraceEntryV1[];
  readonly mismatches: readonly ConformanceMismatchV1[];
  readonly injectedFailures: readonly string[];
  readonly terminalState: ReflectedLifecycleState | "mixed";
  readonly cleanupReport: ConformanceCleanupReportV1;
  readonly violations: readonly string[];
  readonly passed: boolean;
  readonly testOnly: boolean;
}

export function createConformanceResult(
  scenario: ConformanceScenarioV1,
  trace: readonly ConformanceTraceEntryV1[],
  mismatches: readonly ConformanceMismatchV1[],
  injectedFailures: readonly string[],
  terminalState: ReflectedLifecycleState | "mixed",
  cleanupReport: ConformanceCleanupReportV1,
  violations: readonly string[],
): ConformanceResultV1 {
  return {
    schema: "werkstatt/conformance-result@1",
    scenarioId: scenario.scenarioId,
    fixtureArtifactHash: scenario.fixtureArtifactHash,
    initialSetHash: scenario.initialSet.setHash,
    desiredSetHash: scenario.desiredSet.setHash,
    trace,
    mismatches,
    injectedFailures,
    terminalState,
    cleanupReport,
    violations,
    passed: mismatches.length === 0 && violations.length === 0,
    testOnly: true,
  };
}
