/*
<MODULE_CONTRACT>
<purpose>Tests for sternsystem.register extensions: amend path validation, flag handling, rollback (RFC-0532); intake seeding lives in sternsystem-register-intake.test.ts (RFC-1307).</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>REVIEW-CODE-2026-10-16-08 N1/N2: pre-existing content/refs/remote-branch survival on rollback + unborn-HEAD ref cleanup.</item>
  <item>RFC-1307: review-08 N1-N7 — ref-scoped rollback, pre-existing content preservation, svg resolution, explicit io</item>
  <item>REVIEW-CODE-2026-10-16-09 N8/N9/N12: non-git dir survival, remote-branch create-vs-rewind differentiation, dirty-worktree and seed-path-collision refusal.</item>
  <item>REVIEW-CODE-2026-10-16-10 O1/O2: kept-error diagnostic on injected readdir failure (no throw escapes rollback); delete-push argv asserted lease-anchored on the observed remote sha.</item>
  <item>RFC-1307: REVIEW-CODE-2026-10-16-10 O1-O3: typed kept-* outcome for rollback dir removal, lease-anchored remote-ref deletes with in-place verify, footer-promo suffix matcher with deterministic extension preference</item>
  <history>RFC-0532, RFC-1307</history>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cp } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";
import { registerDeps, runSternsystemRegister } from "../sternsystem/sternsystem-register.ts";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";
import { expectData } from "./helpers/kernel-result-helpers.ts";
import { createDefaultIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";

let workspaceRoot: string;

function makeInput(flags: Record<string, unknown>): KernelCommandInput {
  return {
    flags: flags as Record<string, import("@warpgogol/werkstatt-engine/kernel").KernelFlagValue>,
    argv: [],
  };
}

function makeContext(root: string): KernelRuntimeContext {
  return {
    io: createDefaultIO().io,
    workspaceRoot: root,
    logger: {
      section: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      success: () => {},
    },
    dryRun: false,
  } as unknown as KernelRuntimeContext;
}

beforeEach(async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "sternsystem-register-test-"));
  workspaceRoot = join(testRoot, "workspace");
  await mkdir(workspaceRoot, { recursive: true });
  await mkdir(join(workspaceRoot, "docs", "rfcs"), { recursive: true });
  await writeFile(join(workspaceRoot, "docs", "rfcs", "RFC-0001-test.md"), "", "utf8");
  await writeFile(
    join(workspaceRoot, "package.json"),
    JSON.stringify({ version: "4.5.0" }),
    "utf8",
  );
  await writeFile(
    join(workspaceRoot, "uni.registry.yaml"),
    JSON.stringify({ entries: [{ id: "test", semanticId: "test", version: "1.0.0", intent: [] }] }),
    "utf8",
  );
  await mkdir(join(workspaceRoot, "packages", "dummy"), { recursive: true });
  await writeFile(
    join(workspaceRoot, "packages", "dummy", "index.ts"),
    "export const x = 1;\n",
    "utf8",
  );
  // RFC-1125: sternsystem.register preflight requires werkstatt.identity.json + signing key
  await writeFile(join(workspaceRoot, "werkstatt.identity.json"), "{}", "utf8");
  process.env.SIGNING_PRIVATE_KEY = "deadbeef".repeat(8);
});

afterEach(async () => {
  delete process.env.SIGNING_PRIVATE_KEY;
  await rm(join(workspaceRoot, ".."), { recursive: true, force: true });
});

test("amend fails when system does not exist in registry", async () => {
  await expect(
    runSternsystemRegister(
      makeInput({ id: "nonexistent", amend: true }),
      makeContext(workspaceRoot),
    ),
  ).rejects.toThrow(/ENOENT|does not exist|system-config/);
});

test("amend fails when id is not provided", async () => {
  await expect(
    runSternsystemRegister(makeInput({ amend: true }), makeContext(workspaceRoot)),
  ).rejects.toThrow(/requires --id/);
});

test("register fails when cosmicStar is not provided (non-amend)", async () => {
  await expect(
    runSternsystemRegister(
      makeInput({ id: "test-bundle", mirrors: "git@github.com:foo/test.git" }),
      makeContext(workspaceRoot),
    ),
  ).rejects.toThrow(/requires --cosmicStar/);
});

test("register fails when mirrors is not provided (non-amend)", async () => {
  await expect(
    runSternsystemRegister(
      makeInput({ id: "test-bundle", cosmicStar: "Vega" }),
      makeContext(workspaceRoot),
    ),
  ).rejects.toThrow(/requires --mirrors/);
});

test("register rejects TLD-suffixed IDs (RFC-0902)", async () => {
  await expect(
    runSternsystemRegister(
      makeInput({
        id: "warpgogol-com",
        cosmicStar: "Vega",
        mirrors: "git@github.com:foo/test.git",
      }),
      makeContext(workspaceRoot),
    ),
  ).rejects.toThrow(/TLD suffix/);
});

test("register rejects TLD-suffixed IDs with --amend (RFC-0902)", async () => {
  await expect(
    runSternsystemRegister(
      makeInput({ id: "warpgogol-com", amend: true }),
      makeContext(workspaceRoot),
    ),
  ).rejects.toThrow(/TLD suffix/);
});

test("register rolls back registry entry, seeded files and system-state.yaml when mission.open fails", async () => {
  // RFC-1307: register needs a valid intake + biome before any write.
  const fixture = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "intake",
    "fixtures",
    "valid-minimal",
  );
  await cp(fixture, join(workspaceRoot, "onboarding", "dp7", ".input", "intake"), {
    recursive: true,
  });
  vi.spyOn(registerDeps, "checkBiome").mockResolvedValue(null);
  vi.spyOn(registerDeps, "openMission").mockRejectedValue(new Error("materialize failed"));
  const result = await runSternsystemRegister(
    makeInput({
      id: "dp7",
      cosmicStar: "Vega",
      mirrors: "../systems-cache/dp7:non-bare",
      intake: "onboarding/dp7/.input/intake",
      biome: "dp7-03",
    }),
    makeContext(workspaceRoot),
  );
  vi.restoreAllMocks();

  expect(expectData(result).status).toBe("fail");
  expect(result.exitCode).toBe(1);
  expect(expectData(result).diagnostics.some((d) => d.includes("failed"))).toBe(true);

  // systems-cache should be cleaned up entirely — config, seeded content and
  // the system-state.yaml writeSystemState created.
  const cacheDir = join(workspaceRoot, "..", "systems-cache", "dp7");
  expect(existsSync(join(cacheDir, "system-config.yaml"))).toBe(false);
  expect(existsSync(join(cacheDir, "system-state.yaml"))).toBe(false);
  expect(existsSync(join(cacheDir, "system.pin.json"))).toBe(false);
  expect(existsSync(join(cacheDir, "src", "content"))).toBe(false);
});

test("register rewinds clone commits to the pre-register HEAD on failure", async () => {
  // Cache clone is a real git repo with a pre-existing commit — register's
  // writeSystemState auto-commit and the scaffold commit must be rewound,
  // not left on the branch.
  const fixture = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "intake",
    "fixtures",
    "valid-minimal",
  );
  await cp(fixture, join(workspaceRoot, "onboarding", "dp7", ".input", "intake"), {
    recursive: true,
  });
  const cacheDir = join(workspaceRoot, "..", "systems-cache", "dp7");
  await mkdir(cacheDir, { recursive: true });
  const git = (args: string) =>
    execSync(`git ${args}`, { cwd: cacheDir, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  git("init -b main");
  git("config user.email test@test");
  git("config user.name test");
  await writeFile(join(cacheDir, "README.md"), "pre-register\n", "utf8");
  git("add -A");
  git('commit -m "pre-register"');
  const preSha = git("rev-parse HEAD");

  vi.spyOn(registerDeps, "checkBiome").mockResolvedValue(null);
  vi.spyOn(registerDeps, "openMission").mockRejectedValue(new Error("materialize failed"));
  const result = await runSternsystemRegister(
    makeInput({
      id: "dp7",
      cosmicStar: "Vega",
      mirrors: "../systems-cache/dp7:non-bare",
      intake: "onboarding/dp7/.input/intake",
      biome: "dp7-03",
    }),
    makeContext(workspaceRoot),
  );
  vi.restoreAllMocks();

  expect(expectData(result).status).toBe("fail");
  expect(git("rev-parse HEAD")).toBe(preSha);
  expect(existsSync(join(cacheDir, "system-state.yaml"))).toBe(false);
  expect(existsSync(join(cacheDir, "system-config.yaml"))).toBe(false);
  expect(existsSync(join(cacheDir, "src", "content"))).toBe(false);
  expect(existsSync(join(cacheDir, "README.md"))).toBe(true);
});

test("register preserves pre-existing tracked content, untracked files and state on rollback (REVIEW-08 N2)", async () => {
  const fixture = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "intake",
    "fixtures",
    "valid-minimal",
  );
  await cp(fixture, join(workspaceRoot, "onboarding", "dp7", ".input", "intake"), {
    recursive: true,
  });
  const cacheDir = join(workspaceRoot, "..", "systems-cache", "dp7");
  await mkdir(join(cacheDir, "src", "content", "pages", "de"), { recursive: true });
  const git = (args: string) =>
    execSync(`git ${args}`, { cwd: cacheDir, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  git("init -b main");
  git("config user.email test@test");
  git("config user.name test");
  const preContent = "---\ntitle: pre-existing\n---\nbody\n";
  await writeFile(join(cacheDir, "src", "content", "pages", "de", "home.md"), preContent);
  const preState =
    'schemaVersion: "1.0.0"\nsystemId: dp7\ncurrentMission: "dp7-m000000"\nlastRelease: null\n';
  await writeFile(join(cacheDir, "system-state.yaml"), preState);
  git("add -A");
  git('commit -m "pre-register"');
  // Untracked at register start — must survive both the scaffold add and the rewind.
  await writeFile(join(cacheDir, "scratch.txt"), "operator scratch\n", "utf8");

  vi.spyOn(registerDeps, "checkBiome").mockResolvedValue(null);
  vi.spyOn(registerDeps, "openMission").mockRejectedValue(new Error("materialize failed"));
  const result = await runSternsystemRegister(
    makeInput({
      id: "dp7",
      cosmicStar: "Vega",
      mirrors: "../systems-cache/dp7:non-bare",
      intake: "onboarding/dp7/.input/intake",
      biome: "dp7-03",
    }),
    makeContext(workspaceRoot),
  );
  vi.restoreAllMocks();

  expect(expectData(result).status).toBe("fail");
  expect(execSync("cat src/content/pages/de/home.md", { cwd: cacheDir }).toString()).toBe(
    preContent,
  );
  expect(execSync("cat system-state.yaml", { cwd: cacheDir }).toString()).toBe(preState);
  // Register's state write is gone from history; the pre-existing file stays.
  expect(execSync("cat scratch.txt", { cwd: cacheDir }).toString()).toBe("operator scratch\n");
  expect(git("status --porcelain -- src/content/business-profile")).toBe("");
  expect(existsSync(join(cacheDir, "src", "content", "system.md"))).toBe(false);
  expect(existsSync(join(cacheDir, "system-config.yaml"))).toBe(false);
});

test("register keeps pre-existing branch refs and rewinds the pushed remote branch (REVIEW-08 N1)", async () => {
  const fixture = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "intake",
    "fixtures",
    "valid-minimal",
  );
  await cp(fixture, join(workspaceRoot, "onboarding", "dp7", ".input", "intake"), {
    recursive: true,
  });
  const cacheDir = join(workspaceRoot, "..", "systems-cache", "dp7");
  const remoteDir = join(workspaceRoot, "..", "systems-git", "dp7.git");
  await mkdir(cacheDir, { recursive: true });
  await mkdir(remoteDir, { recursive: true });
  const git = (args: string, cwd = cacheDir) =>
    execSync(`git ${args}`, { cwd, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  git("init --bare -b main", remoteDir);
  git("init -b main");
  git("config user.email test@test");
  git("config user.name test");
  await writeFile(join(cacheDir, "README.md"), "pre-register\n", "utf8");
  git("add -A");
  git('commit -m "pre-register"');
  const preSha = git("rev-parse HEAD");
  git("branch keep-me");
  git(`remote add origin ${remoteDir}`);
  git("push -u origin main");
  git("push origin keep-me");

  vi.spyOn(registerDeps, "checkBiome").mockResolvedValue(null);
  vi.spyOn(registerDeps, "openMission").mockRejectedValue(new Error("materialize failed"));
  const result = await runSternsystemRegister(
    makeInput({
      id: "dp7",
      cosmicStar: "Vega",
      mirrors: "../systems-cache/dp7:non-bare",
      intake: "onboarding/dp7/.input/intake",
      biome: "dp7-03",
    }),
    makeContext(workspaceRoot),
  );
  vi.restoreAllMocks();

  expect(expectData(result).status).toBe("fail");
  // The pre-existing branch is untouched and still points at its own commit.
  expect(git("rev-parse keep-me")).toBe(preSha);
  // Local main rewound; the remote branch register pushed is rewound too.
  expect(git("rev-parse HEAD")).toBe(preSha);
  expect(git("rev-parse refs/heads/main", remoteDir)).toBe(preSha);
});

test("register on an unborn HEAD deletes only register-created refs (REVIEW-08 N1)", async () => {
  const fixture = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "intake",
    "fixtures",
    "valid-minimal",
  );
  await cp(fixture, join(workspaceRoot, "onboarding", "dp7", ".input", "intake"), {
    recursive: true,
  });
  const cacheDir = join(workspaceRoot, "..", "systems-cache", "dp7");
  await mkdir(cacheDir, { recursive: true });
  const git = (args: string) =>
    execSync(`git ${args}`, { cwd: cacheDir, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  git("init -b main");
  git("config user.email test@test");
  git("config user.name test");

  vi.spyOn(registerDeps, "checkBiome").mockResolvedValue(null);
  vi.spyOn(registerDeps, "openMission").mockRejectedValue(new Error("materialize failed"));
  const result = await runSternsystemRegister(
    makeInput({
      id: "dp7",
      cosmicStar: "Vega",
      mirrors: "../systems-cache/dp7:non-bare",
      intake: "onboarding/dp7/.input/intake",
      biome: "dp7-03",
    }),
    makeContext(workspaceRoot),
  );
  vi.restoreAllMocks();

  expect(expectData(result).status).toBe("fail");
  // Every ref register created is gone — HEAD is unborn again, no stray commits.
  expect(git("for-each-ref --format='%(refname)' refs/heads")).toBe("");
  expect(existsSync(join(cacheDir, "system-config.yaml"))).toBe(false);
  expect(existsSync(join(cacheDir, "system-state.yaml"))).toBe(false);
  expect(existsSync(join(cacheDir, "src", "content"))).toBe(false);
});

test("register rejects a non-conventional mirrors[0] before any write", async () => {
  const fixture = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "intake",
    "fixtures",
    "valid-minimal",
  );
  await cp(fixture, join(workspaceRoot, "onboarding", "dp7", ".input", "intake"), {
    recursive: true,
  });
  vi.spyOn(registerDeps, "checkBiome").mockResolvedValue(null);
  await expect(
    runSternsystemRegister(
      makeInput({
        id: "dp7",
        cosmicStar: "Vega",
        mirrors: "./nonexistent-repo-path",
        intake: "onboarding/dp7/.input/intake",
        biome: "dp7-03",
      }),
      makeContext(workspaceRoot),
    ),
  ).rejects.toThrow(/mirrors\[0\] must be the conventional/);
});

test("register preserves a pre-existing non-git system dir and restores captured bytes (REVIEW-09 N8)", async () => {
  const fixture = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "intake",
    "fixtures",
    "valid-minimal",
  );
  await cp(fixture, join(workspaceRoot, "onboarding", "dp7", ".input", "intake"), {
    recursive: true,
  });
  // systems-cache/dp7 pre-exists WITHOUT .git and holds foreign content plus a
  // pre-existing system-config.yaml — rollback must leave all of it in place.
  const cacheDir = join(workspaceRoot, "..", "systems-cache", "dp7");
  await mkdir(cacheDir, { recursive: true });
  const preConfig = "schemaVersion: '1.0.0'\nid: dp7\npreExisting: true\n";
  await writeFile(join(cacheDir, "system-config.yaml"), preConfig, "utf8");
  await writeFile(join(cacheDir, "operator-notes.txt"), "do not lose me\n", "utf8");
  const preState =
    'schemaVersion: "1.0.0"\nsystemId: dp7\ncurrentMission: "dp7-m000000"\nlastRelease: null\n';
  await writeFile(join(cacheDir, "system-state.yaml"), preState, "utf8");

  vi.spyOn(registerDeps, "checkBiome").mockResolvedValue(null);
  vi.spyOn(registerDeps, "openMission").mockRejectedValue(new Error("materialize failed"));
  const result = await runSternsystemRegister(
    makeInput({
      id: "dp7",
      cosmicStar: "Vega",
      mirrors: "../systems-cache/dp7:non-bare",
      intake: "onboarding/dp7/.input/intake",
      biome: "dp7-03",
    }),
    makeContext(workspaceRoot),
  );
  vi.restoreAllMocks();

  expect(expectData(result).status).toBe("fail");
  // The pre-existing dir survives; register's files are gone; captured bytes
  // are restored verbatim.
  expect(existsSync(cacheDir)).toBe(true);
  expect(execSync("cat operator-notes.txt", { cwd: cacheDir }).toString()).toBe("do not lose me\n");
  expect(execSync("cat system-config.yaml", { cwd: cacheDir }).toString()).toBe(preConfig);
  expect(execSync("cat system-state.yaml", { cwd: cacheDir }).toString()).toBe(preState);
  expect(existsSync(join(cacheDir, "src", "content"))).toBe(false);
  expect(existsSync(join(cacheDir, "system.pin.json"))).toBe(false);
});

test("rollback keeps the register-created dir when inspection fails (REVIEW-10 O1)", async () => {
  const fixture = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "intake",
    "fixtures",
    "valid-minimal",
  );
  await cp(fixture, join(workspaceRoot, "onboarding", "dp7", ".input", "intake"), {
    recursive: true,
  });
  // systems-cache/dp7 does NOT exist — register creates it, so rollback tries
  // the dir-level removal. Inject a readdir failure on that exact path: the
  // rollback must degrade to a kept-error diagnostic, never a thrown escape.
  const cacheDir = join(workspaceRoot, "..", "systems-cache", "dp7");
  const ctx = makeContext(workspaceRoot);
  const baseIo = ctx.io;
  ctx.io = {
    ...baseIo,
    readdir: async (p: string) => {
      if (p === cacheDir) throw new Error("injected readdir failure");
      return baseIo.readdir(p);
    },
  };

  vi.spyOn(registerDeps, "checkBiome").mockResolvedValue(null);
  vi.spyOn(registerDeps, "openMission").mockRejectedValue(new Error("materialize failed"));
  const result = await runSternsystemRegister(
    makeInput({
      id: "dp7",
      cosmicStar: "Vega",
      mirrors: "../systems-cache/dp7:non-bare",
      intake: "onboarding/dp7/.input/intake",
      biome: "dp7-03",
    }),
    ctx,
  );
  vi.restoreAllMocks();

  // A structured fail result — the injected error did not escape as a throw —
  // and the diagnostic names the real reason (inspection/removal failure).
  const data = expectData(result);
  expect(data.status).toBe("fail");
  expect(
    (data.diagnostics as string[]).some((d) => d.includes("could not inspect or remove")),
  ).toBe(true);
  expect(existsSync(cacheDir)).toBe(true);
});

test("register deletes a remote branch it created and leaves the remote clean (REVIEW-09 N9)", async () => {
  const fixture = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "intake",
    "fixtures",
    "valid-minimal",
  );
  await cp(fixture, join(workspaceRoot, "onboarding", "dp7", ".input", "intake"), {
    recursive: true,
  });
  const cacheDir = join(workspaceRoot, "..", "systems-cache", "dp7");
  const remoteDir = join(workspaceRoot, "..", "systems-git", "dp7.git");
  await mkdir(cacheDir, { recursive: true });
  await mkdir(remoteDir, { recursive: true });
  const git = (args: string, cwd = cacheDir) =>
    execSync(`git ${args}`, { cwd, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  git("init --bare -b main", remoteDir);
  git("init -b main");
  git("config user.email test@test");
  git("config user.name test");
  await writeFile(join(cacheDir, "README.md"), "pre-register\n", "utf8");
  git("add -A");
  git('commit -m "pre-register"');
  const preSha = git("rev-parse HEAD");
  // Remote exists but has NO branches — register's push creates refs/heads/main.
  git(`remote add origin ${remoteDir}`);

  vi.spyOn(registerDeps, "checkBiome").mockResolvedValue(null);
  vi.spyOn(registerDeps, "openMission").mockRejectedValue(new Error("materialize failed"));
  // REVIEW-10 O2: capture every git push argv — the created-ref delete must be
  // lease-anchored on the remote sha observed by rollback, not a bare :ref push.
  const ctx = makeContext(workspaceRoot);
  const baseIo = ctx.io;
  const pushes: string[][] = [];
  ctx.io = {
    ...baseIo,
    exec: async (cmd: string, args: string[], opts?: Parameters<typeof baseIo.exec>[2]) => {
      if (cmd === "git" && args[0] === "push") pushes.push([...args]);
      return baseIo.exec(cmd, args, opts);
    },
  };
  const result = await runSternsystemRegister(
    makeInput({
      id: "dp7",
      cosmicStar: "Vega",
      mirrors: "../systems-cache/dp7:non-bare",
      intake: "onboarding/dp7/.input/intake",
      biome: "dp7-03",
    }),
    ctx,
  );
  vi.restoreAllMocks();

  expect(expectData(result).status).toBe("fail");
  expect(git("rev-parse HEAD")).toBe(preSha);
  // The register-created remote branch is gone — the remote is back to empty.
  expect(git("ls-remote origin 'refs/heads/*'")).toBe("");
  // O2: the attempted delete push carries --force-with-lease anchored to the
  // remote sha observed by rollback (the transport delete is refused by
  // denyDeleteCurrent for local-path remotes, but the lease arg must be there).
  const delPush = pushes.find((a) => a.some((x) => x.startsWith(":refs/heads/")));
  expect(delPush).toBeDefined();
  expect(delPush![1]).toMatch(/^--force-with-lease=refs\/heads\/main:[0-9a-f]{40}$/);
});

test("register leaves a diverged remote branch untouched when its pushes were rejected (REVIEW-09 N9)", async () => {
  const fixture = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "intake",
    "fixtures",
    "valid-minimal",
  );
  await cp(fixture, join(workspaceRoot, "onboarding", "dp7", ".input", "intake"), {
    recursive: true,
  });
  const cacheDir = join(workspaceRoot, "..", "systems-cache", "dp7");
  const remoteDir = join(workspaceRoot, "..", "systems-git", "dp7.git");
  const seederDir = join(workspaceRoot, "..", "systems-git", "dp7-seeder");
  await mkdir(cacheDir, { recursive: true });
  await mkdir(remoteDir, { recursive: true });
  await mkdir(seederDir, { recursive: true });
  const git = (args: string, cwd = cacheDir) =>
    execSync(`git ${args}`, { cwd, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  git("init --bare -b main", remoteDir);
  // Seed the remote with a commit the register clone does NOT have.
  git("init -b main", seederDir);
  git("config user.email test@test", seederDir);
  git("config user.name test", seederDir);
  await writeFile(join(seederDir, "remote-only.txt"), "remote history\n", "utf8");
  git("add -A", seederDir);
  git('commit -m "remote seed"', seederDir);
  const remoteSha = git("rev-parse HEAD", seederDir);
  git(`remote add origin ${remoteDir}`, seederDir);
  git("push origin main", seederDir);
  // Register's clone sits on an unrelated local commit — every register push
  // fails non-fast-forward, so the remote must stay at remoteSha.
  git("init -b main");
  git("config user.email test@test");
  git("config user.name test");
  await writeFile(join(cacheDir, "README.md"), "pre-register\n", "utf8");
  git("add -A");
  git('commit -m "pre-register"');
  const preSha = git("rev-parse HEAD");
  git(`remote add origin ${remoteDir}`);

  vi.spyOn(registerDeps, "checkBiome").mockResolvedValue(null);
  vi.spyOn(registerDeps, "openMission").mockRejectedValue(new Error("materialize failed"));
  const result = await runSternsystemRegister(
    makeInput({
      id: "dp7",
      cosmicStar: "Vega",
      mirrors: "../systems-cache/dp7:non-bare",
      intake: "onboarding/dp7/.input/intake",
      biome: "dp7-03",
    }),
    makeContext(workspaceRoot),
  );
  vi.restoreAllMocks();

  expect(expectData(result).status).toBe("fail");
  expect(git("rev-parse HEAD")).toBe(preSha);
  // The remote branch is exactly where it was — remote-unique history kept.
  expect(git("rev-parse refs/heads/main", remoteDir)).toBe(remoteSha);
  expect(git(`cat-file -p ${remoteSha}:remote-only.txt`, remoteDir)).toBe("remote history");
});

test("register refuses to run on a dirty cache clone before any write (REVIEW-09 N12)", async () => {
  const fixture = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "intake",
    "fixtures",
    "valid-minimal",
  );
  await cp(fixture, join(workspaceRoot, "onboarding", "dp7", ".input", "intake"), {
    recursive: true,
  });
  const cacheDir = join(workspaceRoot, "..", "systems-cache", "dp7");
  await mkdir(cacheDir, { recursive: true });
  const git = (args: string) =>
    execSync(`git ${args}`, { cwd: cacheDir, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  git("init -b main");
  git("config user.email test@test");
  git("config user.name test");
  await writeFile(join(cacheDir, "README.md"), "pre-register\n", "utf8");
  git("add -A");
  git('commit -m "pre-register"');
  // Uncommitted edit on a tracked file — reset --hard would destroy it.
  await writeFile(join(cacheDir, "README.md"), "uncommitted work\n", "utf8");

  vi.spyOn(registerDeps, "checkBiome").mockResolvedValue(null);
  await expect(
    runSternsystemRegister(
      makeInput({
        id: "dp7",
        cosmicStar: "Vega",
        mirrors: "../systems-cache/dp7:non-bare",
        intake: "onboarding/dp7/.input/intake",
        biome: "dp7-03",
      }),
      makeContext(workspaceRoot),
    ),
  ).rejects.toThrow(/uncommitted changes/);
  vi.restoreAllMocks();
  // Refused before the first write — the operator's edit is intact.
  expect(execSync("cat README.md", { cwd: cacheDir }).toString()).toBe("uncommitted work\n");
});

test("register refuses to overwrite a pre-existing file at a planned seed path (REVIEW-09 N12)", async () => {
  const fixture = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "intake",
    "fixtures",
    "valid-minimal",
  );
  await cp(fixture, join(workspaceRoot, "onboarding", "dp7", ".input", "intake"), {
    recursive: true,
  });
  const cacheDir = join(workspaceRoot, "..", "systems-cache", "dp7");
  await mkdir(join(cacheDir, "src", "content"), { recursive: true });
  const preSystem = "---\ntitle: existing system doc\n---\npre-existing\n";
  await writeFile(join(cacheDir, "src", "content", "system.md"), preSystem, "utf8");

  vi.spyOn(registerDeps, "checkBiome").mockResolvedValue(null);
  vi.spyOn(registerDeps, "openMission").mockRejectedValue(new Error("unreachable"));
  const result = await runSternsystemRegister(
    makeInput({
      id: "dp7",
      cosmicStar: "Vega",
      mirrors: "../systems-cache/dp7:non-bare",
      intake: "onboarding/dp7/.input/intake",
      biome: "dp7-03",
    }),
    makeContext(workspaceRoot),
  );
  vi.restoreAllMocks();

  expect(expectData(result).status).toBe("fail");
  // The collision refused the write — and rollback only removes paths register
  // actually wrote, so the pre-existing file is still there verbatim.
  expect(execSync("cat src/content/system.md", { cwd: cacheDir }).toString()).toBe(preSystem);
});
