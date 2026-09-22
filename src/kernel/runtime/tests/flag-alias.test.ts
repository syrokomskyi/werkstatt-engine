import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { KernelCommandDefinition } from "@warpgogol/werkstatt-shared/kernel";
import { resolveSiteFlagAlias } from "../flag-alias.ts";

function missionYaml(missionId: string, systemId: string, state: string): string {
  return [
    "schemaVersion: '1'",
    `missionId: ${missionId}`,
    `systemId: ${systemId}`,
    `state: ${state}`,
    "brief: test mission",
    "openedAt: '2026-01-01T00:00:00Z'",
    "openedBy: test",
    "closedAt: null",
    "closedBy: null",
    "pinAtOpen: abc123",
    "materializedAt: null",
    "reconciledAt: null",
    "migratedAt: null",
    "releaseId: null",
    "operationId: op-1",
    "",
  ].join("\n");
}

function str(required = false): { kind: "string"; required?: boolean; description: string } {
  return { kind: "string", ...(required ? { required } : {}), description: "test flag" };
}

function cmd(
  flags: KernelCommandDefinition["flags"],
  scope = "workspace",
): KernelCommandDefinition {
  return {
    name: "test.command",
    description: "test command",
    scope: scope as KernelCommandDefinition["scope"],
    flags,
    execute: async () => ({ data: {}, exitCode: 0 }),
  } as KernelCommandDefinition;
}

describe("resolveSiteFlagAlias (RFC-1126)", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "flag-alias-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function addMission(missionId: string, systemId: string, state = "open"): void {
    const dir = join(root, "missions", missionId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "mission.yaml"), missionYaml(missionId, systemId, state));
  }

  it("rewrites --site into --mission via the single open mission", async () => {
    addMission("warpgogol-com-m000042", "warpgogol-com");
    const { argv, diagnostic } = await resolveSiteFlagAlias(
      ["--site", "warpgogol-com"],
      cmd({ mission: str(true) }),
      root,
    );
    expect(diagnostic).toBeUndefined();
    expect(argv).toEqual(["--mission", "warpgogol-com-m000042"]);
  });

  it("supports the --site=value inline form", async () => {
    const { argv } = await resolveSiteFlagAlias(
      ["--site=warpgogol-com"],
      cmd({ id: str() }),
      root,
    );
    expect(argv).toEqual(["--id", "warpgogol-com"]);
  });

  it("errors when no open mission exists for the system", async () => {
    addMission("warpgogol-com-m000001", "warpgogol-com", "closed");
    const { diagnostic } = await resolveSiteFlagAlias(
      ["--site", "warpgogol-com"],
      cmd({ mission: str() }),
      root,
    );
    expect(diagnostic?.ruleId).toBe("KERNEL-FLAG-02");
    expect(diagnostic?.message).toContain("no open mission");
  });

  it("errors on ambiguous open missions", async () => {
    addMission("warpgogol-com-m000001", "warpgogol-com");
    addMission("warpgogol-com-m000002", "warpgogol-com");
    const { diagnostic } = await resolveSiteFlagAlias(
      ["--site", "warpgogol-com"],
      cmd({ mission: str() }),
      root,
    );
    expect(diagnostic?.ruleId).toBe("KERNEL-FLAG-02");
    expect(diagnostic?.message).toContain("multiple open missions");
  });

  it("drops --site silently when --mission already targets the same system", async () => {
    addMission("warpgogol-com-m000042", "warpgogol-com");
    const { argv, diagnostic } = await resolveSiteFlagAlias(
      ["--mission", "warpgogol-com-m000042", "--site", "warpgogol-com"],
      cmd({ mission: str() }),
      root,
    );
    expect(diagnostic).toBeUndefined();
    expect(argv).toEqual(["--mission", "warpgogol-com-m000042"]);
  });

  it("errors when --mission and --site target different systems", async () => {
    addMission("other-system-m000007", "other-system");
    const { diagnostic } = await resolveSiteFlagAlias(
      ["--mission", "other-system-m000007", "--site", "warpgogol-com"],
      cmd({ mission: str() }),
      root,
    );
    expect(diagnostic?.ruleId).toBe("KERNEL-FLAG-02");
    expect(diagnostic?.message).toContain("Conflicting targets");
  });

  it("rewrites --site into --id for sternsystem-style commands", async () => {
    const { argv } = await resolveSiteFlagAlias(
      ["--site", "warpgogol-com"],
      cmd({ id: str(true) }),
      root,
    );
    expect(argv).toEqual(["--id", "warpgogol-com"]);
  });

  it("drops --site when --id carries the same value", async () => {
    const { argv, diagnostic } = await resolveSiteFlagAlias(
      ["--id", "warpgogol-com", "--site", "warpgogol-com"],
      cmd({ id: str() }),
      root,
    );
    expect(diagnostic).toBeUndefined();
    expect(argv).toEqual(["--id", "warpgogol-com"]);
  });

  it("errors on conflicting --id and --site", async () => {
    const { diagnostic } = await resolveSiteFlagAlias(
      ["--id", "a", "--site", "b"],
      cmd({ id: str() }),
      root,
    );
    expect(diagnostic?.ruleId).toBe("KERNEL-FLAG-02");
  });

  it("rewrites --site into --system for mission.open-style commands", async () => {
    const { argv } = await resolveSiteFlagAlias(
      ["--site", "warpgogol-com"],
      cmd({ system: str(true) }),
      root,
    );
    expect(argv).toEqual(["--system", "warpgogol-com"]);
  });

  it("is a no-op when the command declares its own site flag", async () => {
    const { argv } = await resolveSiteFlagAlias(
      ["--site", "warpgogol-com"],
      cmd({ site: str(true), id: str() }),
      root,
    );
    expect(argv).toEqual(["--site", "warpgogol-com"]);
  });

  it("is a no-op for site-scoped commands", async () => {
    const { argv } = await resolveSiteFlagAlias(
      ["--site", "warpgogol-com"],
      cmd({ id: str() }, "app"),
      root,
    );
    expect(argv).toEqual(["--site", "warpgogol-com"]);
  });

  it("is a no-op without --site in argv", async () => {
    const { argv } = await resolveSiteFlagAlias(
      ["--id", "x"],
      cmd({ id: str() }),
      root,
    );
    expect(argv).toEqual(["--id", "x"]);
  });
});
