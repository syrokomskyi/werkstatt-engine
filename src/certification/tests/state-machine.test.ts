import { test, expect, describe } from "vitest";
import {
  validateArtifactTransition,
  validateDeploymentTransition,
  ARTIFACT_STATES,
  DEPLOYMENT_STATES,
} from "../state-machine.ts";

describe("ARTIFACT_STATES", () => {
  test("contains prepared and ready", () => {
    expect(ARTIFACT_STATES).toContain("prepared");
    expect(ARTIFACT_STATES).toContain("ready");
  });
});

describe("DEPLOYMENT_STATES", () => {
  test("contains all 10 states", () => {
    expect(DEPLOYMENT_STATES.length).toBe(10);
  });

  test("includes planned, succeeded, failed, rolled-back", () => {
    expect(DEPLOYMENT_STATES).toContain("planned");
    expect(DEPLOYMENT_STATES).toContain("succeeded");
    expect(DEPLOYMENT_STATES).toContain("failed");
    expect(DEPLOYMENT_STATES).toContain("rolled-back");
  });
});

describe("validateArtifactTransition", () => {
  test("allows prepared → ready", () => {
    const result = validateArtifactTransition("prepared", "ready");
    expect(result.ok).toBe(true);
  });

  test("rejects ready → prepared", () => {
    const result = validateArtifactTransition("ready", "prepared");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("CERT-STATE-01");
      expect(result.message).toContain("ready → prepared");
    }
  });

  test("rejects ready → ready (no self-transition)", () => {
    const result = validateArtifactTransition("ready", "ready");
    expect(result.ok).toBe(false);
  });
});

describe("validateDeploymentTransition", () => {
  test("allows planned → authorized", () => {
    const result = validateDeploymentTransition("planned", "authorized");
    expect(result.ok).toBe(true);
  });

  test("allows planned → failed", () => {
    const result = validateDeploymentTransition("planned", "failed");
    expect(result.ok).toBe(true);
  });

  test("allows deploying → deployed", () => {
    const result = validateDeploymentTransition("deploying", "deployed");
    expect(result.ok).toBe(true);
  });

  test("allows verifying → succeeded", () => {
    const result = validateDeploymentTransition("verifying", "succeeded");
    expect(result.ok).toBe(true);
  });

  test("allows succeeded → rollback-authorized", () => {
    const result = validateDeploymentTransition("succeeded", "rollback-authorized");
    expect(result.ok).toBe(true);
  });

  test("rejects planned → deployed (skip)", () => {
    const result = validateDeploymentTransition("planned", "deployed");
    expect(result.ok).toBe(false);
  });

  test("rejects rolled-back → planned (terminal)", () => {
    const result = validateDeploymentTransition("rolled-back", "planned");
    expect(result.ok).toBe(false);
  });

  test("error message includes allowed transitions", () => {
    const result = validateDeploymentTransition("rolled-back", "planned");
    if (!result.ok) {
      expect(result.message).toContain("Allowed:");
    }
  });
});
