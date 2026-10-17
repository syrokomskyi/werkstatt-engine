/*
<MODULE_CONTRACT>
<purpose>
Unit tests for registry io push refspec covering RFC-0981: writeSystemState push refspec in detached HEAD.
</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1311: Compass header sweep — declares the registry suite's contract for test-file scaffold coverage.</item>
</CHANGE_SUMMARY>
*/

// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const gitExecMock = vi.hoisted(() => vi.fn());
const cacheCloneCommitMock = vi.hoisted(() => vi.fn());

vi.mock("../werkstatt/git-exec.js", () => ({
  gitExec: gitExecMock,
}));

vi.mock("../mission/mission-git-commit.js", () => ({
  cacheCloneCommit: cacheCloneCommitMock,
}));

import { writeSystemState } from "../sternsystem/registry-io.ts";
import { resolveCacheClonePath } from "../sternsystem/registry-io.ts";
import type { SystemState } from "@warpgogol/werkstatt-engine/schemas";
import { createDefaultIO, type WorkspaceIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";

type ExecCall = { cmd: string; args: string[] };

// REVIEW-09 N11: the push goes through array-args io.exec (execOrThrow), not a
// shell-interpolated gitExec string — the mock layer is a spy io over the real
// fs adapter, so file writes land on disk and git calls are captured verbatim.
function makeIo(execCalls: ExecCall[], execResult = { exitCode: 0, stdout: "", stderr: "" }) {
  const { io: base } = createDefaultIO();
  const io: WorkspaceIO = {
    ...base,
    exec: async (cmd: string, args: string[]) => {
      execCalls.push({ cmd, args });
      return execResult;
    },
  };
  return io;
}

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
    cacheCloneCommitMock.mockReturnValue(undefined);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("resolves branch via symbolic-ref and pushes with fully-qualified refspec", async () => {
    gitExecMock.mockImplementation((_cwd: string, args: string) =>
      args === "symbolic-ref --short refs/remotes/origin/HEAD" ? "origin/main" : "",
    );
    const execCalls: ExecCall[] = [];

    await writeSystemState(tmpDir, "test-sys", makeState(), makeIo(execCalls));

    const pushCall = execCalls.find((c) => c.args[0] === "push");
    expect(pushCall).toBeDefined();
    expect(pushCall!.args).toEqual([
      "push",
      "--force-with-lease",
      "origin",
      "HEAD:refs/heads/main",
    ]);
    // Array-args form — the remote-derived branch never reaches a shell string.
    expect(pushCall!.cmd).toBe("git");
  });

  it("falls back to main when symbolic-ref fails (no remote HEAD)", async () => {
    gitExecMock.mockImplementation(
      (_cwd: string, args: string, opts?: { allowNonZero?: boolean }) => {
        if (args === "symbolic-ref --short refs/remotes/origin/HEAD") {
          if (opts?.allowNonZero) return "";
          throw new Error("not a symbolic ref");
        }
        return "";
      },
    );
    const execCalls: ExecCall[] = [];

    await writeSystemState(tmpDir, "test-sys", makeState(), makeIo(execCalls));

    const pushCall = execCalls.find((c) => c.args[0] === "push");
    expect(pushCall).toBeDefined();
    expect(pushCall!.args).toEqual([
      "push",
      "--force-with-lease",
      "origin",
      "HEAD:refs/heads/main",
    ]);
  });

  it("resolves non-main branch correctly", async () => {
    gitExecMock.mockImplementation((_cwd: string, args: string) =>
      args === "symbolic-ref --short refs/remotes/origin/HEAD" ? "origin/develop" : "",
    );
    const execCalls: ExecCall[] = [];

    await writeSystemState(tmpDir, "test-sys", makeState(), makeIo(execCalls));

    const pushCall = execCalls.find((c) => c.args[0] === "push");
    expect(pushCall).toBeDefined();
    expect(pushCall!.args).toEqual([
      "push",
      "--force-with-lease",
      "origin",
      "HEAD:refs/heads/develop",
    ]);
  });

  it("push failure is non-fatal (warning emitted, no throw)", async () => {
    gitExecMock.mockImplementation((_cwd: string, args: string) =>
      args === "symbolic-ref --short refs/remotes/origin/HEAD" ? "origin/main" : "",
    );
    const onWarn = vi.fn();
    const execCalls: ExecCall[] = [];

    await expect(
      writeSystemState(
        tmpDir,
        "test-sys",
        makeState(),
        makeIo(execCalls, { exitCode: 1, stdout: "", stderr: "push failed: branch diverged" }),
        onWarn,
      ),
    ).resolves.not.toThrow();
    expect(onWarn).toHaveBeenCalledWith(
      expect.stringContaining("[writeSystemState] git push failed for test-sys"),
    );
  });

  it("does not use rev-parse --abbrev-ref HEAD", async () => {
    gitExecMock.mockImplementation((_cwd: string, args: string) =>
      args === "symbolic-ref --short refs/remotes/origin/HEAD" ? "origin/main" : "",
    );
    const execCalls: ExecCall[] = [];

    await writeSystemState(tmpDir, "test-sys", makeState(), makeIo(execCalls));

    const revParseCall = execCalls.find((c) =>
      c.args.join(" ").includes("rev-parse --abbrev-ref HEAD"),
    );
    expect(revParseCall).toBeUndefined();
    const gitExecRevParse = gitExecMock.mock.calls.find((c) =>
      (c[1] as string).includes("rev-parse --abbrev-ref HEAD"),
    );
    expect(gitExecRevParse).toBeUndefined();
  });
});
