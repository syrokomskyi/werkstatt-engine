/*
<MODULE_CONTRACT>
  <purpose>RFC-0899: Unit tests for leitstand.access.status command — reads system-state.yaml and reports PIN protection status.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0899: Initial access status command tests.</item>
</CHANGE_SUMMARY>
*/

import { describe, expect, it, vi } from "vitest";

vi.mock("../../sternsystem/registry-io.ts", () => ({
  readSystemConfigSmart: vi.fn(),
  readSystemStateSmart: vi.fn(),
  writeSystemState: vi.fn(),
}));

const { runLeitstandAccessStatus } = await import("../access-commands");
const { readSystemStateSmart } = await import("../../sternsystem/registry-io.ts");

function makeInput(flags: Record<string, unknown>) {
  return { flags, args: [] } as unknown as Parameters<typeof runLeitstandAccessStatus>[0];
}

function makeContext(workspaceRoot: string) {
  return { workspaceRoot, dryRun: false, site: undefined } as unknown as Parameters<
    typeof runLeitstandAccessStatus
  >[1];
}

describe("RFC-0899: leitstand.access.status", () => {
  it("reports protected when accessPin is set", async () => {
    vi.mocked(readSystemStateSmart).mockResolvedValueOnce({
      schemaVersion: "1.0.0",
      systemId: "test-bundle",
      currentMission: null,
      lastRelease: null,
      lastPropagated: {},
      accessPin: "1234",
    });
    const result = await runLeitstandAccessStatus(
      makeInput({ site: "test-bundle" }),
      makeContext("/tmp/test"),
    );
    expect(result.data!.protected).toBe(true);
    expect(result.data!.accessPin).toBe("1234");
    expect(result.summary).toContain("protected");
  });

  it("reports unprotected when accessPin is null", async () => {
    vi.mocked(readSystemStateSmart).mockResolvedValueOnce({
      schemaVersion: "1.0.0",
      systemId: "test-bundle",
      currentMission: null,
      lastRelease: null,
      lastPropagated: {},
      accessPin: null,
    });
    const result = await runLeitstandAccessStatus(
      makeInput({ site: "test-bundle" }),
      makeContext("/tmp/test"),
    );
    expect(result.data!.protected).toBe(false);
    expect(result.data!.accessPin).toBe(null);
    expect(result.summary).toContain("unprotected");
  });

  it("throws if --site is missing", async () => {
    await expect(runLeitstandAccessStatus(makeInput({}), makeContext("/tmp/test"))).rejects.toThrow(
      "--site is required",
    );
  });

  it("accepts --system as alias for --site", async () => {
    vi.mocked(readSystemStateSmart).mockResolvedValueOnce({
      schemaVersion: "1.0.0",
      systemId: "alias-site",
      currentMission: null,
      lastRelease: null,
      lastPropagated: {},
      accessPin: "9999",
    });
    const result = await runLeitstandAccessStatus(
      makeInput({ system: "alias-site" }),
      makeContext("/tmp/test"),
    );
    expect(result.data!.systemId).toBe("alias-site");
    expect(result.data!.protected).toBe(true);
  });
});
