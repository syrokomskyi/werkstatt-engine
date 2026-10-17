/*
<MODULE_CONTRACT>
  <purpose>
    RFC-1284 AC-12: unit coverage for isProtectedLiveTarget — the predicate that
    decides whether certify's measurement target is a protected live host
    (channel target always; explicit --base-url when its hostname matches a
    configured dev/alt channel URL, with a ^(dev|alt)[.-] prefix fallback for
    hosts absent from channel config; candidate-preview never qualifies).
  </purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1284: initial — AC-12 predicate coverage (REVIEW-CODE-2026-10-15-02 F6).</item>
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
</CHANGE_SUMMARY>
*/

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../sternsystem/registry-io.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../sternsystem/registry-io.ts")>();
  return {
    ...original,
    readSystemConfigSmart: vi.fn(),
  };
});

import { readSystemConfigSmart } from "../../sternsystem/registry-io.ts";
import { isProtectedLiveTarget } from "../certify.ts";
import type { SystemConfig } from "@warpgogol/werkstatt-engine/schemas";

const readConfigMock = vi.mocked(readSystemConfigSmart);

function configWithChannels(devUrl?: string, altUrl?: string): SystemConfig {
  return {
    id: "acme",
    deployment: {
      channels: {
        dev: { url: devUrl },
        alt: { url: altUrl },
      },
    },
  } as SystemConfig;
}

describe("isProtectedLiveTarget (RFC-1284 AC-12)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("--target channel is always a protected live target", async () => {
    await expect(isProtectedLiveTarget(undefined, "channel", "/ws", "acme")).resolves.toBe(true);
    expect(readConfigMock).not.toHaveBeenCalled();
  });

  it("candidate target without --base-url is never protected", async () => {
    await expect(isProtectedLiveTarget(undefined, "candidate", "/ws", "acme")).resolves.toBe(false);
    expect(readConfigMock).not.toHaveBeenCalled();
  });

  it("--base-url matching the dev channel hostname is protected", async () => {
    readConfigMock.mockResolvedValue(
      configWithChannels("https://dev-acme.workers.dev", "https://alt-acme.workers.dev"),
    );
    await expect(
      isProtectedLiveTarget("https://dev-acme.workers.dev/some/path", "candidate", "/ws", "acme"),
    ).resolves.toBe(true);
  });

  it("--base-url matching the alt channel hostname is protected", async () => {
    readConfigMock.mockResolvedValue(
      configWithChannels("https://dev-acme.workers.dev", "https://alt-acme.workers.dev"),
    );
    await expect(
      isProtectedLiveTarget("https://alt-acme.workers.dev", "candidate", "/ws", "acme"),
    ).resolves.toBe(true);
  });

  it("--base-url on an unrelated host is not protected", async () => {
    readConfigMock.mockResolvedValue(
      configWithChannels("https://dev-acme.workers.dev", "https://alt-acme.workers.dev"),
    );
    await expect(
      isProtectedLiveTarget("http://localhost:8787", "candidate", "/ws", "acme"),
    ).resolves.toBe(false);
  });

  it("falls back to the dev-/alt- prefix when channel config is unreadable", async () => {
    readConfigMock.mockRejectedValue(new Error("no systems-cache"));
    await expect(
      isProtectedLiveTarget("https://dev-warpgogol-com.acc.workers.dev", "candidate", "/ws", "acme"),
    ).resolves.toBe(true);
    await expect(
      isProtectedLiveTarget("https://api.example.com", "candidate", "/ws", "acme"),
    ).resolves.toBe(false);
  });

  it("malformed --base-url is not protected", async () => {
    await expect(isProtectedLiveTarget("not-a-url", "candidate", "/ws", "acme")).resolves.toBe(false);
    expect(readConfigMock).not.toHaveBeenCalled();
  });
});
