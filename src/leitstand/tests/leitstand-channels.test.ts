/*
<MODULE_CONTRACT>
  <purpose>RFC-1203: unit tests for leitstand.channels — the relabeling alias of leitstand.status covering result parity, summary/data relabeling, shared flag declaration, and failure delegation.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1203: initial tests for leitstand.channels covering exit-code/channel-data parity with leitstand.status, [leitstand.channels] summary prefix + data.aliasedTo, shared flags object identity on both declarations, and identical missing-site failure.</item>
</CHANGE_SUMMARY>
*/

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createDefaultIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";

vi.mock("../../sternsystem/registry-io.ts", () => ({
  readSystemConfigSmart: vi.fn(),
  readSystemStateSmart: vi.fn(),
  resolveCacheClonePath: vi.fn(),
  resolveActiveWorkpieceDir: vi.fn().mockResolvedValue(null),
}));

const { runLeitstandStatus, runLeitstandChannels } = await import("../leitstand-commands.ts");
const { createLeitstandModule } = await import("../leitstand.module.ts");
const { resolveCacheClonePath } = await import("../../sternsystem/registry-io.ts");

function makeInput(flags: Record<string, unknown>) {
  return { flags, args: [] } as unknown as Parameters<typeof runLeitstandStatus>[0];
}

function makeContext(workspaceRoot: string) {
  return {
    io: createDefaultIO().io,
    workspaceRoot,
    dryRun: false,
    site: undefined,
  } as unknown as Parameters<typeof runLeitstandStatus>[1];
}

const workspaceRoot = mkdtempSync(join(tmpdir(), "leitstand-channels-"));
const cacheCloneDir = join(workspaceRoot, "cache-clone");
const opsDir = join(cacheCloneDir, "deployment-operations");

mkdirSync(opsDir, { recursive: true });
for (const [channel, at] of [
  ["dev", "2026-10-01T10:00:00.000Z"],
  ["alt", "2026-10-02T11:00:00.000Z"],
  ["main", "2026-10-03T12:00:00.000Z"],
] as const) {
  writeFileSync(
    join(opsDir, `op-${channel}.json`),
    JSON.stringify({
      operationId: `op-${channel}`,
      channel,
      candidateId: "r000010",
      state: "succeeded",
      timestamp: at,
    }),
  );
}

vi.mocked(resolveCacheClonePath).mockReturnValue(cacheCloneDir);

afterAll(() => {
  rmSync(workspaceRoot, { recursive: true, force: true });
});

describe("leitstand.channels (RFC-1203)", () => {
  it("returns the same exit code and channel data as leitstand.status (AC-1, AC-2)", async () => {
    const input = makeInput({ site: "test-site" });
    const context = makeContext(workspaceRoot);

    const canonical = await runLeitstandStatus(input, context);
    const alias = await runLeitstandChannels(input, context);

    expect(alias.exitCode).toBe(canonical.exitCode);
    const { aliasedTo: _dropped, ...aliasData } = alias.data ?? {};
    expect(aliasData, "alias channel data must equal canonical output").toEqual(canonical.data);
  });

  it("relabels the result: [leitstand.channels] summary prefix naming the canonical command + data.aliasedTo (AC-4, AC-5)", async () => {
    const alias = await runLeitstandChannels(makeInput({ site: "test-site" }), makeContext(workspaceRoot));

    expect(alias.summary).toMatch(/^\[leitstand\.channels\]/);
    expect(alias.summary, "alias summary must name the canonical command").toContain("leitstand.status");
    expect(alias.summary).not.toMatch(/^\[leitstand\.status\]/);
    expect(alias.data?.aliasedTo).toBe("leitstand.status");
  });

  it("does not stamp aliasedTo on the canonical command result", async () => {
    const canonical = await runLeitstandStatus(makeInput({ site: "test-site" }), makeContext(workspaceRoot));
    expect(canonical.data?.aliasedTo).toBeUndefined();
  });

  it("shares the exact flags/reads declaration objects with leitstand.status (AC-3)", async () => {
    const mod = await createLeitstandModule();
    const status = mod.commands.find((c) => c.name === "leitstand.status");
    const channels = mod.commands.find((c) => c.name === "leitstand.channels");

    expect(channels, "leitstand.channels must be registered").toBeDefined();
    expect(channels?.mutatesState).toBe(false);
    expect(channels?.flags, "alias must reuse the canonical flags object by reference").toBe(status?.flags);
    expect(channels?.reads).toBe(status?.reads);
    expect(channels?.scope).toBe(status?.scope);
    expect(channels?.supportsAllSites).toBe(status?.supportsAllSites);
  });

  it("propagates the canonical failure verbatim on missing --site (AC-6)", async () => {
    const input = makeInput({});
    const context = makeContext(workspaceRoot);

    await expect(runLeitstandStatus(input, context)).rejects.toThrow("[leitstand.status] --site is required");
    await expect(runLeitstandChannels(input, context)).rejects.toThrow(
      "[leitstand.status] --site is required",
    );
  });
});
