// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const gitExecMock = vi.hoisted(() => vi.fn());
const cacheCloneCommitMock = vi.hoisted(() => vi.fn());
const execSyncMock = vi.hoisted(() => vi.fn());

vi.mock("../werkstatt/git-exec.js", () => ({
  gitExec: gitExecMock,
}));

vi.mock("../mission/mission-git-commit.js", () => ({
  cacheCloneCommit: cacheCloneCommitMock,
}));

vi.mock("node:child_process", () => ({
  execSync: execSyncMock,
}));

import { writeSystemState } from "../sternsystem/registry-io.ts";
import { resolveCacheClonePath } from "../sternsystem/registry-io.ts";
import type { SystemState } from "@warpgogol/werkstatt-engine/schemas";

function makeState(): SystemState {
  return {
    lastRelease: null,
    currentMission: null,
    deploymentChannels: {},
    accessPin: null,
    passportRequired: false,
    ownershipRequired: false,
  } as unknown as SystemState;
}

describe("RFC-0981: writeSystemState push refspec in detached HEAD", () => {
  let tmpDir: string;
  let cacheClone: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "rfc-0981-"));
    cacheClone = resolveCacheClonePath(tmpDir, "test-sys");
    mkdirSync(cacheClone, { recursive: true });
    mkdirSync(join(cacheClone, ".git"), { recursive: true });

    vi.clearAllMocks();
    execSyncMock.mockReturnValue(""); // git add system-state.yaml
    cacheCloneCommitMock.mockReturnValue(undefined);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("resolves branch via symbolic-ref and pushes with fully-qualified refspec", async () => {
    gitExecMock.mockImplementation((_cwd: string, args: string) => {
      if (args === "symbolic-ref --short refs/remotes/origin/HEAD") {
        return "origin/main";
      }
      if (args.startsWith("push origin ")) {
        return "";
      }
      throw new Error(`Unexpected git args: ${args}`);
    });

    await writeSystemState(tmpDir, "test-sys", makeState());

    const pushCall = gitExecMock.mock.calls.find((c) =>
      (c[1] as string).startsWith("push origin "),
    );
    expect(pushCall).toBeDefined();
    expect(pushCall![1]).toBe("push origin HEAD:refs/heads/main");
  });

  it("falls back to main when symbolic-ref fails (no remote HEAD)", async () => {
    gitExecMock.mockImplementation(
      (_cwd: string, args: string, opts?: { allowNonZero?: boolean }) => {
        if (args === "symbolic-ref --short refs/remotes/origin/HEAD") {
          if (opts?.allowNonZero) return "";
          throw new Error("not a symbolic ref");
        }
        if (args.startsWith("push origin ")) {
          return "";
        }
        throw new Error(`Unexpected git args: ${args}`);
      },
    );

    await writeSystemState(tmpDir, "test-sys", makeState());

    const pushCall = gitExecMock.mock.calls.find((c) =>
      (c[1] as string).startsWith("push origin "),
    );
    expect(pushCall).toBeDefined();
    expect(pushCall![1]).toBe("push origin HEAD:refs/heads/main");
  });

  it("resolves non-main branch correctly", async () => {
    gitExecMock.mockImplementation((_cwd: string, args: string) => {
      if (args === "symbolic-ref --short refs/remotes/origin/HEAD") {
        return "origin/develop";
      }
      if (args.startsWith("push origin ")) {
        return "";
      }
      throw new Error(`Unexpected git args: ${args}`);
    });

    await writeSystemState(tmpDir, "test-sys", makeState());

    const pushCall = gitExecMock.mock.calls.find((c) =>
      (c[1] as string).startsWith("push origin "),
    );
    expect(pushCall).toBeDefined();
    expect(pushCall![1]).toBe("push origin HEAD:refs/heads/develop");
  });

  it("push failure is non-fatal (warning emitted, no throw)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    gitExecMock.mockImplementation((_cwd: string, args: string) => {
      if (args === "symbolic-ref --short refs/remotes/origin/HEAD") {
        return "origin/main";
      }
      if (args.startsWith("push origin ")) {
        throw new Error("push failed: branch diverged");
      }
      throw new Error(`Unexpected git args: ${args}`);
    });

    await expect(writeSystemState(tmpDir, "test-sys", makeState())).resolves.not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[writeSystemState] git push failed for test-sys"),
    );
    warnSpy.mockRestore();
  });

  it("does not use rev-parse --abbrev-ref HEAD", async () => {
    gitExecMock.mockImplementation((_cwd: string, args: string) => {
      if (args === "symbolic-ref --short refs/remotes/origin/HEAD") {
        return "origin/main";
      }
      if (args.startsWith("push origin ")) {
        return "";
      }
      throw new Error(`Unexpected git args: ${args}`);
    });

    await writeSystemState(tmpDir, "test-sys", makeState());

    const revParseCall = gitExecMock.mock.calls.find((c) =>
      (c[1] as string).includes("rev-parse --abbrev-ref HEAD"),
    );
    expect(revParseCall).toBeUndefined();
  });
});
