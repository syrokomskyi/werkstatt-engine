/**
 * <module_info>
 * <purpose>Unit tests for the RFC-1327 run-twice harness: convergence acceptance, status drift detection, state drift detection, and the snapshotGitTree probe.</purpose>
 * </module_info>
 * <change_summary>
 * <item>RFC-1327: harness self-tests.</item>
 * </change_summary>
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { expectRerunSafe, snapshotGitTree } from "./run-twice.ts";

describe("expectRerunSafe", () => {
  it("accepts a converging command (idempotent counter)", async () => {
    let count = 0;
    const { first, second } = await expectRerunSafe({
      run: async () => ({ status: "ok", exitCode: 0, ...(count++ === 0 ? {} : {}) }),
      snapshot: () => "stable",
    });
    expect(first.status).toBe("ok");
    expect(second.status).toBe("ok");
  });

  it("rejects a second run that reports a different status", async () => {
    let run = 0;
    await expect(
      expectRerunSafe({
        run: async () => ({ status: run++ === 0 ? "ok" : "failed", exitCode: run === 1 ? 0 : 1 }),
        snapshot: () => "stable",
      }),
    ).rejects.toThrow();
  });

  it("rejects a second run that mutates owned state", async () => {
    let state = "a";
    await expect(
      expectRerunSafe({
        run: async () => {
          const cur = state;
          state = state + "x";
          return { status: "ok", exitCode: 0, _cur: cur } as never;
        },
        snapshot: () => state,
      }),
    ).rejects.toThrow(/not rerun-safe/);
  });

  it("honours expectSecondRun overrides", async () => {
    let run = 0;
    const { second } = await expectRerunSafe({
      run: async () => ({ status: run++ === 0 ? "ok" : "already-done", exitCode: 0 }),
      snapshot: () => "stable",
      expectSecondRun: (_f, s) => expect(s.status).toBe("already-done"),
    });
    expect(second.status).toBe("already-done");
  });
});

describe("snapshotGitTree", () => {
  it("captures HEAD + porcelain status of a repo", () => {
    const dir = mkdtempSync(join(tmpdir(), "run-twice-"));
    execSync("git init -q && git config user.email t@t && git config user.name t", { cwd: dir });
    writeFileSync(join(dir, "a.txt"), "one");
    execSync("git add a.txt && git commit -qm init", { cwd: dir });
    const clean = snapshotGitTree(dir);
    expect(clean).toMatch(/^[0-9a-f]{40}\n$/);

    writeFileSync(join(dir, "b.txt"), "two");
    const dirty = snapshotGitTree(dir);
    expect(dirty).toContain("?? b.txt");
    expect(dirty).not.toBe(clean);
  });
});
