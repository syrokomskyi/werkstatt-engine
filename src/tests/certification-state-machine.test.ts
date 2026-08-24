import { describe, it, expect } from "vitest";
import {
  validateArtifactTransition,
  validateDeploymentTransition,
  isDeploymentOperationState,
  isReleaseArtifactState,
  ARTIFACT_STATES,
  DEPLOYMENT_STATES,
  type DeploymentOperationState,
} from "../certification/state-machine.ts";

describe("artifact state machine", () => {
  it("allows prepared → ready", () => {
    const result = validateArtifactTransition("prepared", "ready");
    expect(result.ok).toBe(true);
  });

  it("blocks ready → prepared (no backward)", () => {
    const result = validateArtifactTransition("ready", "prepared");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("CERT-STATE-01");
      expect(result.from).toBe("ready");
      expect(result.to).toBe("prepared");
    }
  });

  it("blocks ready → ready (terminal state)", () => {
    const result = validateArtifactTransition("ready", "ready");
    expect(result.ok).toBe(false);
  });

  it("blocks prepared → prepared (no self-transition)", () => {
    const result = validateArtifactTransition("prepared", "prepared");
    expect(result.ok).toBe(false);
  });

  it("ARTIFACT_STATES contains exactly prepared and ready", () => {
    expect(ARTIFACT_STATES).toEqual(["prepared", "ready"]);
  });
});

describe("deployment state machine", () => {
  it("allows planned → authorized", () => {
    expect(validateDeploymentTransition("planned", "authorized").ok).toBe(true);
  });

  it("allows planned → failed", () => {
    expect(validateDeploymentTransition("planned", "failed").ok).toBe(true);
  });

  it("allows authorized → deploying", () => {
    expect(validateDeploymentTransition("authorized", "deploying").ok).toBe(true);
  });

  it("allows deploying → deployed", () => {
    expect(validateDeploymentTransition("deploying", "deployed").ok).toBe(true);
  });

  it("allows deployed → verifying", () => {
    expect(validateDeploymentTransition("deployed", "verifying").ok).toBe(true);
  });

  it("allows verifying → succeeded", () => {
    expect(validateDeploymentTransition("verifying", "succeeded").ok).toBe(true);
  });

  it("allows verifying → failed", () => {
    expect(validateDeploymentTransition("verifying", "failed").ok).toBe(true);
  });

  it("allows succeeded → rollback-authorized", () => {
    expect(validateDeploymentTransition("succeeded", "rollback-authorized").ok).toBe(true);
  });

  it("allows failed → rollback-authorized", () => {
    expect(validateDeploymentTransition("failed", "rollback-authorized").ok).toBe(true);
  });

  it("allows rollback-authorized → rolling-back", () => {
    expect(validateDeploymentTransition("rollback-authorized", "rolling-back").ok).toBe(true);
  });

  it("allows rolling-back → rolled-back", () => {
    expect(validateDeploymentTransition("rolling-back", "rolled-back").ok).toBe(true);
  });

  it("blocks rolled-back → any (terminal)", () => {
    const states: DeploymentOperationState[] = [
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
    for (const target of states) {
      expect(validateDeploymentTransition("rolled-back", target).ok).toBe(false);
    }
  });

  it("blocks unauthorized transitions (e.g. planned → deployed)", () => {
    const result = validateDeploymentTransition("planned", "deployed");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("CERT-STATE-01");
    }
  });

  it("blocks backward transitions (e.g. deployed → deploying)", () => {
    expect(validateDeploymentTransition("deployed", "deploying").ok).toBe(false);
  });

  it("DEPLOYMENT_STATES has exactly 10 states", () => {
    expect(DEPLOYMENT_STATES).toHaveLength(10);
  });
});

describe("state guards", () => {
  it("isReleaseArtifactState accepts valid states", () => {
    expect(isReleaseArtifactState("prepared")).toBe(true);
    expect(isReleaseArtifactState("ready")).toBe(true);
  });

  it("isReleaseArtifactState rejects legacy states", () => {
    expect(isReleaseArtifactState("published")).toBe(false);
    expect(isReleaseArtifactState("alt-deployed")).toBe(false);
    expect(isReleaseArtifactState("promoted")).toBe(false);
    expect(isReleaseArtifactState("rolled-back")).toBe(false);
    expect(isReleaseArtifactState("dev-deployed")).toBe(false);
    expect(isReleaseArtifactState("main-deployed")).toBe(false);
  });

  it("isDeploymentOperationState accepts valid states", () => {
    const valid: DeploymentOperationState[] = [
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
    for (const s of valid) {
      expect(isDeploymentOperationState(s)).toBe(true);
    }
  });

  it("isDeploymentOperationState rejects invalid strings", () => {
    expect(isDeploymentOperationState("published")).toBe(false);
    expect(isDeploymentOperationState("prepared")).toBe(false);
    expect(isDeploymentOperationState("")).toBe(false);
    expect(isDeploymentOperationState("COMPLETE")).toBe(false);
  });
});
