/*
<MODULE_CONTRACT>
  <purpose>
    RFC-1284: sternsystem.validate ACCESS-01/02 diagnostics — desired-vs-live
    access protection reconciliation. ACCESS-01 flags protection drift (pin
    declared but a configured dev/alt channel answers non-401); transport
    failures are warnings, never violations; suspended systems skip the probe.
    ACCESS-02 warns on suspension markers older than one hour.
  </purpose>
  <responsibilities>
    <item>Red: declared pin + channel answers 200 → ACCESS-01 violation.</item>
    <item>Green: declared pin + channel answers 401 → no finding.</item>
    <item>Green: transport-error → ACCESS-01 warning, not violation.</item>
    <item>Green: suspension marker present → probe skipped entirely.</item>
    <item>Green: marker older than 1h → ACCESS-02 warning; fresh marker → none.</item>
  </responsibilities>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1284: initial — ACCESS-01/02 coverage for checkAccessProtection.</item>
  <item>RFC-1284: ACCESS-01/02 diagnostics in sternsystem.validate

RFC-1284 step 5: checkAccessProtection compares desired accessPin to
observed channel answers — a proven non-401 is a violation, transport
failures downgrade to warnings, suspended systems skip the probe, and
stale markers (>1h) warn via ACCESS-02.</item>
</CHANGE_SUMMARY>
*/

import { describe, it, expect } from "vitest";
import type { SystemConfig, SystemState } from "@warpgogol/werkstatt-engine/schemas";
import type { AccessProbeResult } from "@warpgogol/werkstatt-shared/node/access-probe";
import { checkAccessProtection } from "../sternsystem-validate.ts";

function makeEntry(): SystemConfig {
  return {
    id: "acme",
    deployment: {
      channels: {
        dev: { url: "https://dev-acme.workers.dev" },
        alt: { url: "https://alt-acme.workers.dev" },
      },
    },
  } as SystemConfig;
}

function makeState(
  overrides: Partial<Pick<SystemState, "accessPin" | "accessPinSuspended">> = {},
): Pick<SystemState, "accessPin" | "accessPinSuspended"> {
  return { accessPin: "1234", accessPinSuspended: null, ...overrides };
}

function probeReturning(result: AccessProbeResult) {
  const calls: string[] = [];
  const probe = async (url: string) => {
    calls.push(url);
    return result;
  };
  return { probe, calls };
}

describe("checkAccessProtection — ACCESS-01 (RFC-1284)", () => {
  it("violates when a declared pin channel answers non-401", async () => {
    const violations: Array<{ systemId: string; rule: string; message: string }> = [];
    const warnings: Array<{ systemId: string; field: string; message: string }> = [];
    const { probe } = probeReturning({ outcome: "status", status: 200 });

    await checkAccessProtection(makeEntry(), makeState(), violations, warnings, probe);

    expect(violations).toHaveLength(2);
    expect(violations[0]).toMatchObject({ systemId: "acme", rule: "ACCESS-01" });
    expect(violations[0]?.message).toContain("200");
    expect(warnings).toHaveLength(0);
  });

  it("passes when every declared pin channel answers 401", async () => {
    const violations: Array<{ systemId: string; rule: string; message: string }> = [];
    const warnings: Array<{ systemId: string; field: string; message: string }> = [];
    const { probe, calls } = probeReturning({ outcome: "status", status: 401 });

    await checkAccessProtection(makeEntry(), makeState(), violations, warnings, probe);

    expect(calls).toEqual(["https://dev-acme.workers.dev", "https://alt-acme.workers.dev"]);
    expect(violations).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  it("downgrades transport failures to warnings, never violations", async () => {
    const violations: Array<{ systemId: string; rule: string; message: string }> = [];
    const warnings: Array<{ systemId: string; field: string; message: string }> = [];
    const { probe } = probeReturning({ outcome: "transport-error", error: "timed out" });

    await checkAccessProtection(makeEntry(), makeState(), violations, warnings, probe);

    expect(violations).toHaveLength(0);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatchObject({ systemId: "acme", field: "ACCESS-01" });
    expect(warnings[0]?.message).toContain("timed out");
  });

  it("skips the probe entirely while a suspension marker exists", async () => {
    const violations: Array<{ systemId: string; rule: string; message: string }> = [];
    const warnings: Array<{ systemId: string; field: string; message: string }> = [];
    const { probe, calls } = probeReturning({ outcome: "status", status: 200 });
    const state = makeState({
      accessPinSuspended: {
        at: new Date().toISOString(),
        by: "leitstand.certify",
        operationId: null,
      },
    });

    await checkAccessProtection(makeEntry(), state, violations, warnings, probe);

    expect(calls).toHaveLength(0);
    expect(violations).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  it("probes nothing when accessPin is null (unprotected)", async () => {
    const violations: Array<{ systemId: string; rule: string; message: string }> = [];
    const warnings: Array<{ systemId: string; field: string; message: string }> = [];
    const { probe, calls } = probeReturning({ outcome: "status", status: 200 });

    await checkAccessProtection(
      makeEntry(),
      makeState({ accessPin: null }),
      violations,
      warnings,
      probe,
    );

    expect(calls).toHaveLength(0);
    expect(violations).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });
});

describe("checkAccessProtection — ACCESS-02 (RFC-1284)", () => {
  it("warns when the suspension marker is older than one hour", async () => {
    const violations: Array<{ systemId: string; rule: string; message: string }> = [];
    const warnings: Array<{ systemId: string; field: string; message: string }> = [];
    const { probe } = probeReturning({ outcome: "status", status: 401 });
    const state = makeState({
      accessPinSuspended: {
        at: new Date(Date.now() - 61 * 60 * 1000).toISOString(),
        by: "leitstand.certify",
        operationId: null,
      },
    });

    await checkAccessProtection(makeEntry(), state, violations, warnings, probe);

    expect(violations).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ systemId: "acme", field: "ACCESS-02" });
  });

  it("stays silent on a fresh suspension marker", async () => {
    const violations: Array<{ systemId: string; rule: string; message: string }> = [];
    const warnings: Array<{ systemId: string; field: string; message: string }> = [];
    const { probe } = probeReturning({ outcome: "status", status: 401 });
    const state = makeState({
      accessPinSuspended: {
        at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        by: "operator",
        operationId: "op-1",
      },
    });

    await checkAccessProtection(makeEntry(), state, violations, warnings, probe);

    expect(warnings).toHaveLength(0);
  });
});
