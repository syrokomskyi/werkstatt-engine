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
