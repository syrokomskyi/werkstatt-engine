/*
<MODULE_CONTRACT>
<purpose>state-machine — deployment operation state machine for certification run lifecycles.</purpose>
<non-goals>
  <item>Do not orchestrate — the state machine only defines legal transitions.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

import type { ReleaseArtifactState } from "../schemas/release.ts";
import type { DeploymentOperationStateV1 } from "./contracts/state.ts";

export type DeploymentOperationState =
  | "planned"
  | "authorized"
  | "deploying"
  | "deployed"
  | "verifying"
  | "succeeded"
  | "failed"
  | "rollback-authorized"
  | "rolling-back"
  | "rolled-back";

export type TransitionResultV1 =
  | { ok: true; from: ReleaseArtifactState | DeploymentOperationState; to: ReleaseArtifactState | DeploymentOperationState }
  | { ok: false; code: "CERT-STATE-01"; from: string; to: string; message: string };

const ARTIFACT_TRANSITIONS: Record<ReleaseArtifactState, ReleaseArtifactState[]> = {
  prepared: ["ready"],
  ready: [],
};

const DEPLOYMENT_TRANSITIONS: Record<DeploymentOperationState, DeploymentOperationState[]> = {
  planned: ["authorized", "failed"],
  authorized: ["deploying", "failed"],
  deploying: ["deployed", "failed"],
  deployed: ["verifying", "failed"],
  verifying: ["succeeded", "failed"],
  succeeded: ["rollback-authorized"],
  failed: ["rollback-authorized"],
  "rollback-authorized": ["rolling-back", "failed"],
  "rolling-back": ["rolled-back", "failed"],
  "rolled-back": [],
};

export function validateArtifactTransition(
  from: ReleaseArtifactState,
  to: ReleaseArtifactState,
): TransitionResultV1 {
  const allowed = ARTIFACT_TRANSITIONS[from] ?? [];
  if (allowed.includes(to)) {
    return { ok: true, from, to };
  }
  return {
    ok: false,
    code: "CERT-STATE-01",
    from,
    to,
    message: `Invalid artifact transition: ${from} → ${to}. Allowed: ${allowed.length === 0 ? "(none)" : allowed.join(", ")}`,
  };
}

export function validateDeploymentTransition(
  from: DeploymentOperationState,
  to: DeploymentOperationState,
): TransitionResultV1 {
  const allowed = DEPLOYMENT_TRANSITIONS[from] ?? [];
  if (allowed.includes(to)) {
    return { ok: true, from, to };
  }
  return {
    ok: false,
    code: "CERT-STATE-01",
    from,
    to,
    message: `Invalid deployment transition: ${from} → ${to}. Allowed: ${allowed.length === 0 ? "(none)" : allowed.join(", ")}`,
  };
}

export const ARTIFACT_STATES: readonly ReleaseArtifactState[] = ["prepared", "ready"];

export const DEPLOYMENT_STATES: readonly DeploymentOperationState[] = [
  "planned",
  "authorized",
  "deploying",
  "deployed",
  "verifying",
  "succeeded",
  "failed",
  "rollback-authorized",
  "rolling-back",
  "rolled-back",
];

export function isDeploymentOperationState(value: string): value is DeploymentOperationState {
  return DEPLOYMENT_STATES.includes(value as DeploymentOperationState);
}

export function isReleaseArtifactState(value: string): value is ReleaseArtifactState {
  return ARTIFACT_STATES.includes(value as ReleaseArtifactState);
}

export type { DeploymentOperationStateV1 };
