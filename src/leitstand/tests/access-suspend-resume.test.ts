/*
<MODULE_CONTRACT>
  <purpose>RFC-1284: Unit tests for leitstand.access.suspend and
  leitstand.access.resume — crash-safe suspension markers, normalization in
  protect/unprotect, and per-channel failure semantics.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1284: initial — suspension marker lifecycle coverage.</item>
  <item>RFC-1284: fix review REVIEW-CODE-2026-10-15-02: RFC-1284 — single-store marker, flag=false proceed, surfaced reconcile

F1: marker store unified on the git-tracked cache clone — access commands,
certify entry check, and deploy reconcile all use non-smart
readSystemState/writeSystemState (decisions Q-6); the mission-window
blindness and the DNA-106 false-resume are gone.
F2: --auto-manage-pin=false + suspension at entry skips entry-resume and
proceeds on the open channel (decisions Q-7) — RFC/AC-8 text amended.
F3: accessReconcile surfaced in data + summary of dev-deploy/propagate.
F4: CHANGE_SUMMARY items on all touched files.
F5: sternsystem.validate declares ACCESS-01/02 + system-state.yaml reads.
F6: isProtectedLiveTarget exported and covered (AC-12 probe repointed).
F7: fresh-read ordering proven — suspension opened mid-deploy suppresses
the re-assert.</item>
  <history>RFC-1284</history>
</CHANGE_SUMMARY>
*/

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";
import type { SystemState } from "@warpgogol/werkstatt-engine/schemas";

vi.mock("../../sternsystem/registry-io.ts", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../sternsystem/registry-io.ts")>();
  return {
    ...mod,
    readSystemConfigSmart: vi.fn(),
    readSystemState: vi.fn(),
    writeSystemState: vi.fn(),
  };
});

vi.mock("../adapters/wrangler-secrets.ts", () => ({
  runWranglerSecretPut: vi.fn(),
  runWranglerSecretDelete: vi.fn(),
}));

const {
  runLeitstandAccessSuspend,
  runLeitstandAccessResume,
  runLeitstandAccessProtect,
  runLeitstandAccessUnprotect,
} = await import("../access-commands.ts");
const { readSystemConfigSmart, readSystemState, writeSystemState } =
  await import("../../sternsystem/registry-io.ts");
const { runWranglerSecretPut, runWranglerSecretDelete } =
  await import("../adapters/wrangler-secrets.ts");

function makeInput(flags: Record<string, unknown>) {
  return { flags, args: [] } as unknown as Parameters<typeof runLeitstandAccessSuspend>[0];
}

function makeContext(workspaceRoot: string) {
  return {
    io: createDefaultIO().io,
    workspaceRoot,
    dryRun: false,
    site: undefined,
  } as unknown as Parameters<typeof runLeitstandAccessSuspend>[1];
}

function makeState(overrides: Partial<SystemState>): SystemState {
  return {
    schemaVersion: "1.0.0",
    systemId: "test-bundle",
    currentMission: null,
    lastRelease: null,
    lastPropagated: {},
    accessPin: null,
    accessPinSuspended: null,
    passportRequired: false,
    ownershipRequired: false,
    ...overrides,
  };
}

function makeConfig() {
  return {
    deployment: {
      channels: {
        dev: { workerName: "dev-test-bundle", url: "https://dev.example.com" },
        alt: { workerName: "alt-test-bundle", url: "https://alt.example.com" },
      },
    },
  } as unknown as Awaited<ReturnType<typeof readSystemConfigSmart>>;
}

const wranglerOk = { exitCode: 0, stdout: "", stderr: "" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RFC-1284: leitstand.access.suspend", () => {
  it("deletes ACCESS_PIN on dev/alt and writes the suspension marker preserving accessPin", async () => {
    vi.mocked(readSystemConfigSmart).mockResolvedValueOnce(makeConfig());
    vi.mocked(readSystemState).mockResolvedValueOnce(makeState({ accessPin: "1234" }));
    vi.mocked(runWranglerSecretDelete).mockResolvedValue(wranglerOk);

    const result = await runLeitstandAccessSuspend(
      makeInput({ site: "test-bundle", by: "leitstand.certify", "operation-id": "certify-1" }),
      makeContext("/tmp/test"),
    );

    expect(runWranglerSecretDelete).toHaveBeenCalledTimes(2);
    const written = vi.mocked(writeSystemState).mock.calls[0][2];
    expect(written.accessPin).toBe("1234");
    expect(written.accessPinSuspended).toMatchObject({
      by: "leitstand.certify",
      operationId: "certify-1",
    });
    expect(written.accessPinSuspended!.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.exitCode).toBeUndefined();
    expect(result.data!.suspended).toEqual(written.accessPinSuspended);
  });

  it("refuses when accessPin is null — nothing to suspend", async () => {
    vi.mocked(readSystemConfigSmart).mockResolvedValueOnce(makeConfig());
    vi.mocked(readSystemState).mockResolvedValueOnce(makeState({ accessPin: null }));

    await expect(
      runLeitstandAccessSuspend(makeInput({ site: "test-bundle" }), makeContext("/tmp/test")),
    ).rejects.toThrow("nothing to suspend");
    expect(runWranglerSecretDelete).not.toHaveBeenCalled();
    expect(writeSystemState).not.toHaveBeenCalled();
  });

  it("does not write a marker when a channel delete fails", async () => {
    vi.mocked(readSystemConfigSmart).mockResolvedValueOnce(makeConfig());
    vi.mocked(readSystemState).mockResolvedValueOnce(makeState({ accessPin: "1234" }));
    vi.mocked(runWranglerSecretDelete)
      .mockResolvedValueOnce(wranglerOk)
      .mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "boom" });

    const result = await runLeitstandAccessSuspend(
      makeInput({ site: "test-bundle" }),
      makeContext("/tmp/test"),
    );

    expect(
      result.exitCode,
      "Partial delete must exit non-zero (DNA-106) and leave no marker — drift stays ACCESS-01-visible",
    ).toBe(1);
    expect(writeSystemState).not.toHaveBeenCalled();
    expect(result.data!.suspended).toBeNull();
  });
});

describe("RFC-1284: leitstand.access.resume", () => {
  const marker = { at: "2026-10-15T10:00:00.000Z", by: "leitstand.certify", operationId: null };

  it("re-puts ACCESS_PIN from accessPin on dev/alt and clears the marker", async () => {
    vi.mocked(readSystemState).mockResolvedValueOnce(
      makeState({ accessPin: "1234", accessPinSuspended: marker }),
    );
    vi.mocked(readSystemConfigSmart).mockResolvedValueOnce(makeConfig());
    vi.mocked(runWranglerSecretPut).mockResolvedValue(wranglerOk);

    const result = await runLeitstandAccessResume(
      makeInput({ site: "test-bundle" }),
      makeContext("/tmp/test"),
    );

    expect(runWranglerSecretPut).toHaveBeenCalledTimes(2);
    expect(vi.mocked(runWranglerSecretPut).mock.calls[0][2]).toBe("1234");
    const written = vi.mocked(writeSystemState).mock.calls[0][2];
    expect(written.accessPin).toBe("1234");
    expect(written.accessPinSuspended).toBeNull();
    expect(result.exitCode).toBeUndefined();
    expect(result.data!.resumed).toBe(true);
  });

  it("is a no-op when the system is not suspended", async () => {
    vi.mocked(readSystemState).mockResolvedValueOnce(makeState({ accessPin: "1234" }));

    const result = await runLeitstandAccessResume(
      makeInput({ site: "test-bundle" }),
      makeContext("/tmp/test"),
    );

    expect(result.exitCode).toBe(0);
    expect(result.data!.resumed).toBe(false);
    expect(runWranglerSecretPut).not.toHaveBeenCalled();
  });

  it("keeps the marker when a channel restore fails", async () => {
    vi.mocked(readSystemState).mockResolvedValueOnce(
      makeState({ accessPin: "1234", accessPinSuspended: marker }),
    );
    vi.mocked(readSystemConfigSmart).mockResolvedValueOnce(makeConfig());
    vi.mocked(runWranglerSecretPut)
      .mockResolvedValueOnce(wranglerOk)
      .mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "boom" });

    const result = await runLeitstandAccessResume(
      makeInput({ site: "test-bundle" }),
      makeContext("/tmp/test"),
    );

    expect(
      result.exitCode,
      "Partial restore must exit non-zero and keep the marker so ACCESS-01 stays muted",
    ).toBe(1);
    expect(writeSystemState).not.toHaveBeenCalled();
    expect(result.data!.resumed).toBe(false);
  });

  it("errors when suspended but accessPin is null — cannot resume an unknown pin", async () => {
    vi.mocked(readSystemState).mockResolvedValueOnce(
      makeState({ accessPin: null, accessPinSuspended: marker }),
    );

    await expect(
      runLeitstandAccessResume(makeInput({ site: "test-bundle" }), makeContext("/tmp/test")),
    ).rejects.toThrow("access.protect");
    expect(runWranglerSecretPut).not.toHaveBeenCalled();
  });
});

describe("RFC-1284: marker normalization", () => {
  it("protect clears a stale suspension marker", async () => {
    const marker = { at: "2026-10-15T09:00:00.000Z", by: "leitstand.certify", operationId: null };
    vi.mocked(readSystemConfigSmart).mockResolvedValueOnce(makeConfig());
    vi.mocked(readSystemState).mockResolvedValueOnce(
      makeState({ accessPin: "1111", accessPinSuspended: marker }),
    );
    vi.mocked(runWranglerSecretPut).mockResolvedValue(wranglerOk);

    await runLeitstandAccessProtect(
      makeInput({ site: "test-bundle", pin: "5678" }),
      makeContext("/tmp/test"),
    );

    const written = vi.mocked(writeSystemState).mock.calls[0][2];
    expect(written.accessPin).toBe("5678");
    expect(
      written.accessPinSuspended,
      "protect must normalize accessPinSuspended to null — a freshly asserted pin is not suspended",
    ).toBeNull();
  });

  it("unprotect clears both accessPin and the suspension marker", async () => {
    const marker = { at: "2026-10-15T09:00:00.000Z", by: "operator", operationId: null };
    vi.mocked(readSystemConfigSmart).mockResolvedValueOnce(makeConfig());
    vi.mocked(readSystemState).mockResolvedValueOnce(
      makeState({ accessPin: "1111", accessPinSuspended: marker }),
    );
    vi.mocked(runWranglerSecretDelete).mockResolvedValue(wranglerOk);

    await runLeitstandAccessUnprotect(makeInput({ site: "test-bundle" }), makeContext("/tmp/test"));

    const written = vi.mocked(writeSystemState).mock.calls[0][2];
    expect(written.accessPin).toBeNull();
    expect(
      written.accessPinSuspended,
      "unprotect must dissolve the marker — permanent unprotection leaves no suspension",
    ).toBeNull();
  });
});
