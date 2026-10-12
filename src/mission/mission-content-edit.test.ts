/*
<MODULE_CONTRACT>
<purpose>RFC-1263: mission.content-edit composite tests — eligibility routing (AC-2),
gate ordering + drift stop (AC-1/AC-3), shared reconcile/close precondition
(AC-4), fastLane manifest record + bordbuch lane (AC-6), advisory activation.</purpose>
<keywords>RFC-1263, content fast-lane, mission.content-edit, eligibility, fastLane</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1263: initial test file.</item>
  <item>RFC-1263</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { parse as parseYaml } from "yaml";

import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";
import { createDefaultIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";

import { runMissionContentEdit } from "./mission-content-edit.ts";
import { runMissionReconcile } from "./mission-materialization-commands.ts";
import { runMissionClose } from "./mission-close.ts";
import { missionHasGreenCoverage } from "./lifecycle-precondition.ts";
import { readMissionManifest } from "./mission-io.ts";

// ─── mocks ───────────────────────────────────────────────────────────────────

const mockExecuteKernelCommand = vi.hoisted(() => vi.fn());
const mockRunMissionValidate = vi.hoisted(() =>
  vi.fn(async () => ({
    exitCode: 0,
    data: { contractFull: { passed: true, validators: [] } },
    summary: "Validation passed",
  })),
);
const mockAppendBordbuch = vi.hoisted(() =>
  vi.fn(async () => ({
    entry: { id: "event-000001", kind: "mission-close" },
    commitResult: { commitSha: "abc123", pushed: true, error: null },
  })),
);

vi.mock("@warpgogol/werkstatt-engine/kernel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@warpgogol/werkstatt-engine/kernel")>();
  return { ...actual, executeKernelCommand: mockExecuteKernelCommand };
});

vi.mock("../mission/mission-materialization-commands.ts", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../mission/mission-materialization-commands.ts")>();
  return {
    ...actual,
    // mission.close's inline gate is the only surface swapped — runMissionReconcile
    // stays real so AC-4 exercises the actual coverage predicate.
    runMissionValidate: mockRunMissionValidate,
  };
});

vi.mock("../bordbuch/bordbuch-io.ts", () => ({
  validateBordbuch: vi.fn(async () => ({ entries: 0, violations: [] })),
  readBordbuch: vi.fn(async () => []),
  commitAndPushBordbuch: vi.fn(async () => ({ commitSha: "abc123", pushed: true, error: null })),
}));

vi.mock("../bordbuch/bordbuch-commit-helper.ts", () => ({
  appendAndCommitBordbuch: mockAppendBordbuch,
}));

// ─── fixture ─────────────────────────────────────────────────────────────────

const SITE = "test-sys";
const MISSION = `${SITE}-m000001`;

let testRoot: string;
let workspaceRoot: string; // tmpDir/workspace — engine workspace
let cacheClone: string; // tmpDir/systems-cache/<site> — sibling convention
let workpiece: string; // missions/<mission>/workpiece

const SYSTEM_MD = `---
app: ${SITE}
version: "1.0.0"
identity:
  systemStar: Polaris
  biome: core
clientEditable:
  - pages
  - prose
---

# System
`;

function write(base: string, rel: string, content: string): void {
  const abs = join(base, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content);
}

function gitInit(dir: string): void {
  execSync("git init -b main", { cwd: dir, stdio: "pipe" });
  execSync("git config user.email test@test.com", { cwd: dir, stdio: "pipe" });
  execSync("git config user.name Test", { cwd: dir, stdio: "pipe" });
}

function gitCommitAll(dir: string, msg: string): void {
  execSync("git add -A", { cwd: dir, stdio: "pipe" });
  execSync(`git commit -m ${JSON.stringify(msg)}`, { cwd: dir, stdio: "pipe" });
}

function seedCacheClone(contentEditLane?: string): void {
  write(
    cacheClone,
    "system-state.yaml",
    [
      `schemaVersion: "1.0.0"`,
      `systemId: ${SITE}`,
      `currentMission: ${MISSION}`,
      `lastRelease: null`,
      `accessPin: null`,
      `passportRequired: false`,
      `ownershipRequired: false`,
      contentEditLane ? `contentEditLane: ${contentEditLane}` : null,
      "",
    ]
      .filter((l): l is string => l !== null)
      .join("\n"),
  );
  write(cacheClone, "src/content/system.md", SYSTEM_MD);
}

function seedMission(opts: { fastLane?: object } = {}): void {
  const missionDir = join(workspaceRoot, "missions", MISSION);
  mkdirSync(join(missionDir, "evidence"), { recursive: true });
  mkdirSync(join(missionDir, "workpiece"), { recursive: true });
  workpiece = join(missionDir, "workpiece");
  write(workpiece, "src/content/system.md", SYSTEM_MD);
  write(workpiece, "src/content/pages/de/test.md", "---\ntitle: Alt\nlang: de\n---\n");
  gitInit(workpiece);
  gitCommitAll(workpiece, "materialize");

  const manifest = {
    schemaVersion: "1.0.0",
    missionId: MISSION,
    systemId: SITE,
    state: "open",
    brief: "Test mission",
    openedAt: "2026-07-30T00:00:00.000Z",
    openedBy: "test-agent",
    closedAt: null,
    closedBy: null,
    pinAtOpen: "1.0.0",
    materializedAt: "2026-07-30T01:00:00.000Z",
    migratedAt: null,
    reconciledAt: null,
    releaseId: null,
    rfcId: null,
    operationId: "op-001",
    ...(opts.fastLane ? { fastLane: opts.fastLane } : {}),
  };
  writeFileSync(join(missionDir, "mission.yaml"), JSON.stringify(manifest, null, 2) + "\n");
}

function makeInput(flags: Record<string, string | boolean>): KernelCommandInput {
  return { argv: [], flags } as unknown as KernelCommandInput;
}

function makeContext(): KernelRuntimeContext {
  return {
    io: createDefaultIO().io,
    workspaceRoot,
    logger: { info: () => {}, warn: () => {}, error: () => {}, success: () => {}, debug: () => {} },
    dryRun: false,
    siteExplicit: false,
    outputFormat: "json",
  } as unknown as KernelRuntimeContext;
}

/** Default green gate chain for the composite's delegated steps. */
function mockGreenSteps(overrides: Record<string, { exitCode: number; data?: object }> = {}): void {
  mockExecuteKernelCommand.mockImplementation(async ({ commandName }: { commandName: string }) => {
    if (overrides[commandName]) {
      return { exitCode: overrides[commandName].exitCode, data: overrides[commandName].data ?? {} };
    }
    switch (commandName) {
      case "mission.open":
        return { exitCode: 0, data: { missionId: MISSION, state: "open" } };
      case "content.patch":
        return {
          exitCode: 0,
          data: {
            status: "applied",
            diagnostics: [],
            results: [],
            validators: [{ command: "typography.validate", status: "pass", violations: 0 }],
          },
        };
      case "content.regression.check":
        return { exitCode: 0, data: { diagnostics: [] } };
      case "mission.deploy-preflight":
        return { exitCode: 0, data: { totalViolations: 1 } };
      case "mission.git.commit":
        return { exitCode: 0, data: { commitSha: "c".repeat(40) } };
      case "mission.reconcile":
        return { exitCode: 0, data: {} };
      case "mission.close":
        return { exitCode: 0, data: { state: "closed" } };
      default:
        return { exitCode: 0, data: {} };
    }
  });
}

function callsOf(name: string): string[][] {
  return mockExecuteKernelCommand.mock.calls
    .filter((c) => (c[0] as { commandName: string }).commandName === name)
    .map((c) => (c[0] as { argv: string[] }).argv);
}

function writeOpsFile(entries: Array<Record<string, unknown>>): string {
  const opsPath = join(testRoot, "ops.yaml");
  writeFileSync(opsPath, `ops:\n${entries.map((e) => `  - ${JSON.stringify(e)}`).join("\n")}\n`);
  return opsPath;
}

beforeEach(() => {
  mockExecuteKernelCommand.mockReset();
  mockRunMissionValidate.mockClear();
  mockAppendBordbuch.mockClear();
  testRoot = mkdtempSync(join(tmpdir(), "tmp-content-edit-"));
  workspaceRoot = join(testRoot, "workspace");
  cacheClone = join(testRoot, "systems-cache", SITE);
  mkdirSync(workspaceRoot, { recursive: true });
});

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

// ─── AC-1: admitted mission runs the gate set, commits, reconciles, closes ────

test("AC-1 advisory: ops file inside clientEditable runs gates, commits, reconciles, stops before close", async () => {
  seedMission();
  seedCacheClone(); // no contentEditLane → advisory
  mockGreenSteps();
  const opsFile = writeOpsFile([{ op: "set", selector: "pages/de/test#title", value: "Neu" }]);

  const res = await runMissionContentEdit(
    makeInput({ mission: MISSION, "ops-file": opsFile }),
    makeContext(),
  );

  expect(res.exitCode).toBe(0);
  expect(res.data?.status).toBe("fast-lane-ready");
  expect(res.data?.lane).toBe("fast");
  expect(res.data?.reconciled).toBe(true);
  expect(res.data?.closed).toBe(false);

  const order = mockExecuteKernelCommand.mock.calls.map(
    (c) => (c[0] as { commandName: string }).commandName,
  );
  expect(order).toEqual([
    "content.patch",
    "content.regression.check",
    "mission.deploy-preflight",
    "mission.git.commit",
    "mission.reconcile",
  ]);
  expect(callsOf("mission.close")).toHaveLength(0);

  // Gate record persisted on the mission manifest (AC-6 first half).
  const manifest = await readMissionManifest(workspaceRoot, MISSION);
  expect(manifest.fastLane?.green).toBe(true);
  expect(manifest.fastLane?.gates.map((g) => g.gate)).toEqual([
    "content-ops",
    "author-validators",
    "content-regression",
    "deploy-preflight",
    "mission.git.commit",
    "mission.reconcile",
  ]);
});

test("AC-1 active: contentEditLane=active closes the mission after reconcile", async () => {
  seedMission();
  seedCacheClone("active");
  mockGreenSteps();
  const opsFile = writeOpsFile([{ op: "set", selector: "pages/de/test#title", value: "Neu" }]);

  const res = await runMissionContentEdit(
    makeInput({ mission: MISSION, "ops-file": opsFile }),
    makeContext(),
  );

  expect(res.exitCode).toBe(0);
  expect(res.data?.status).toBe("closed");
  expect(res.data?.closed).toBe(true);
  expect(callsOf("mission.close")).toHaveLength(1);
  const gates = res.data?.gates ?? [];
  expect(gates.find((g) => g.gate === "deploy-preflight")?.status).toBe("advisory");
  expect(gates.every((g) => g.status !== "fail")).toBe(true);
});

test("AC-1 open path: --site opens a content-lane mission then runs the gate set", async () => {
  seedCacheClone(); // advisory — stops before close
  write(cacheClone, "src/content/pages/de/test.md", "---\ntitle: Alt\nlang: de\n---\n");

  mockExecuteKernelCommand.mockImplementation(
    async ({ commandName, argv }: { commandName: string; argv: string[] }) => {
      if (commandName === "mission.open") {
        // Emulate the materialized mission the real open produces.
        const missionDir = join(workspaceRoot, "missions", MISSION);
        workpiece = join(missionDir, "workpiece");
        mkdirSync(join(missionDir, "evidence"), { recursive: true });
        write(workpiece, "src/content/system.md", SYSTEM_MD);
        write(workpiece, "src/content/pages/de/test.md", "---\ntitle: Alt\nlang: de\n---\n");
        gitInit(workpiece);
        gitCommitAll(workpiece, "materialize");
        writeFileSync(
          join(missionDir, "mission.yaml"),
          JSON.stringify(
            {
              schemaVersion: "1.0.0",
              missionId: MISSION,
              systemId: SITE,
              state: "open",
              brief: "test",
              openedAt: "2026-07-30T00:00:00.000Z",
              openedBy: "test-agent",
              closedAt: null,
              closedBy: null,
              pinAtOpen: "1.0.0",
              materializedAt: "2026-07-30T01:00:00.000Z",
              migratedAt: null,
              reconciledAt: null,
              releaseId: null,
              rfcId: null,
              operationId: "op-001",
              lane: "content",
            },
            null,
            2,
          ) + "\n",
        );
        expect(argv).toContain("--lane=content");
        return { exitCode: 0, data: { missionId: MISSION, state: "open" } };
      }
      if (commandName === "content.patch") {
        return {
          exitCode: 0,
          data: { status: "applied", diagnostics: [], results: [], validators: [] },
        };
      }
      if (commandName === "mission.git.commit") {
        return { exitCode: 0, data: { commitSha: "c".repeat(40) } };
      }
      return { exitCode: 0, data: {} };
    },
  );

  const opsFile = writeOpsFile([{ op: "set", selector: "pages/de/test#title", value: "Neu" }]);
  const res = await runMissionContentEdit(
    makeInput({ site: SITE, brief: "wording fix", "ops-file": opsFile }),
    makeContext(),
  );

  expect(res.exitCode).toBe(0);
  expect(res.data?.mission).toBe(MISSION);
  expect(res.data?.status).toBe("fast-lane-ready");
  const order = mockExecuteKernelCommand.mock.calls.map(
    (c) => (c[0] as { commandName: string }).commandName,
  );
  expect(order[0]).toBe("mission.open");
  expect(order).toContain("mission.reconcile");
});

// ─── AC-2: ineligible touched set → lane "full", nothing runs ─────────────────

test("AC-2: selector outside clientEditable rejects with lane full and runs nothing", async () => {
  seedMission();
  seedCacheClone();
  mockGreenSteps();
  const opsFile = writeOpsFile([{ op: "set", selector: "config/secrets#token", value: "x" }]);

  const res = await runMissionContentEdit(
    makeInput({ mission: MISSION, "ops-file": opsFile }),
    makeContext(),
  );

  expect(res.exitCode).toBe(1);
  expect(res.data?.status).toBe("rejected");
  expect(res.data?.lane).toBe("full");
  expect(res.data?.eligibility.reasons.join(" ")).toContain("clientEditable");
  expect(mockExecuteKernelCommand).not.toHaveBeenCalled();
});

test("AC-2: staged file outside src/content rejects", async () => {
  seedMission();
  seedCacheClone();
  mockGreenSteps();
  // Dirty a non-content file in the workpiece.
  write(workpiece, "astro.config.mjs", "export default {};\n");

  const res = await runMissionContentEdit(makeInput({ mission: MISSION }), makeContext());

  expect(res.data?.status).toBe("rejected");
  expect(res.data?.lane).toBe("full");
  expect(res.data?.eligibility.reasons.join(" ")).toContain("src/content/");
  expect(mockExecuteKernelCommand).not.toHaveBeenCalled();
});

test("AC-2: non-editable generated path rejects with owner reason", async () => {
  seedMission();
  seedCacheClone();
  mockGreenSteps();
  write(
    workpiece,
    ".werkstatt/generated-paths.generated.yaml",
    `version: 1\npaths:\n  - path: "src/content/pages/gen/**"\n    owner: "pages.gen"\n`,
  );
  write(workpiece, "src/content/pages/gen/x.md", "---\ntitle: g\nlang: de\n---\n");
  const opsFile = writeOpsFile([{ op: "set", selector: "pages/gen/x#title", value: "y" }]);

  const res = await runMissionContentEdit(
    makeInput({ mission: MISSION, "ops-file": opsFile }),
    makeContext(),
  );

  expect(res.data?.status).toBe("rejected");
  expect(res.data?.eligibility.reasons.join(" ")).toContain("generated");
  expect(mockExecuteKernelCommand).not.toHaveBeenCalled();
});

test("AC-2: block.* op routes to the full lane", async () => {
  seedMission();
  seedCacheClone();
  mockGreenSteps();
  const opsFile = writeOpsFile([{ op: "block.remove", selector: "pages/de/test#blocks[id=hero]" }]);

  const res = await runMissionContentEdit(
    makeInput({ mission: MISSION, "ops-file": opsFile }),
    makeContext(),
  );

  expect(res.data?.status).toBe("rejected");
  expect(res.data?.lane).toBe("full");
  expect(res.data?.eligibility.reasons.join(" ")).toContain("structural");
  expect(mockExecuteKernelCommand).not.toHaveBeenCalled();
});

// ─── AC-3: CREG drift stops before commit ─────────────────────────────────────

test("AC-3: content-regression drift stops before mission.git.commit", async () => {
  seedMission();
  seedCacheClone();
  mockGreenSteps({
    "content.regression.check": {
      exitCode: 1,
      data: { diagnostics: [{ severity: "error", ruleId: "CREG-01" }] },
    },
  });
  const opsFile = writeOpsFile([{ op: "set", selector: "pages/de/test#title", value: "Neu" }]);

  const res = await runMissionContentEdit(
    makeInput({ mission: MISSION, "ops-file": opsFile }),
    makeContext(),
  );

  expect(res.exitCode).toBe(1);
  expect(res.data?.status).toBe("gate-failed");
  expect(res.data?.gates.find((g) => g.gate === "content-regression")?.status).toBe("fail");
  expect(res.summary).toContain("RFC-0734");
  expect(callsOf("mission.git.commit")).toHaveLength(0);

  // No fastLane record persisted — reconcile must still refuse the mission.
  const manifest = await readMissionManifest(workspaceRoot, MISSION);
  expect(manifest.fastLane).toBeUndefined();
});

// ─── AC-4: reconcile accepts green fastLane record; refuses neither ───────────

test("AC-4: missionHasGreenCoverage — report green, fastLane green, neither", () => {
  const base = {} as Parameters<typeof missionHasGreenCoverage>[0];
  expect(missionHasGreenCoverage(base, { contractFull: { passed: true } })).toBe(true);
  expect(
    missionHasGreenCoverage(
      { fastLane: { green: true, gates: [], recordedAt: "2026-07-30T00:00:00.000Z" } },
      null,
    ),
  ).toBe(true);
  expect(missionHasGreenCoverage(base, { contractFull: { passed: false } })).toBe(false);
  expect(missionHasGreenCoverage(base, null)).toBe(false);
});

test("AC-4: reconcile without report and without fastLane refuses", async () => {
  seedMission();
  seedCacheClone();

  await expect(runMissionReconcile(makeInput({ mission: MISSION }), makeContext())).rejects.toThrow(
    "run mission.validate first",
  );
});

test("AC-4: reconcile with green fastLane record and no validation report proceeds past the coverage gate", async () => {
  seedMission({
    fastLane: {
      green: true,
      gates: [{ gate: "content-ops", status: "pass" }],
      recordedAt: "2026-07-30T03:00:00.000Z",
    },
  });
  seedCacheClone();

  // The coverage gate passes — reconcile then fails on a downstream step
  // (locks/git in a partial fixture), never on the validation precondition.
  const err = await runMissionReconcile(makeInput({ mission: MISSION }), makeContext()).then(
    () => null,
    (e: unknown) => (e instanceof Error ? e.message : String(e)),
  );
  expect(err === null || !/mission\.validate|validation did not pass/.test(err)).toBe(true);
});

// ─── AC-6: close bordbuch event carries lane ──────────────────────────────────

test("AC-6: mission.close on a fast-lane mission skips inline validate and records lane: fast", async () => {
  seedMission({
    fastLane: {
      green: true,
      gates: [{ gate: "content-ops", status: "pass" }],
      recordedAt: "2026-07-30T03:00:00.000Z",
    },
  });
  seedCacheClone("active");

  // Close needs reconciledAt + the reconciliation report the mirror check reads.
  const missionDir = join(workspaceRoot, "missions", MISSION);
  const manifestRaw = parseYaml(readFileSync(join(missionDir, "mission.yaml"), "utf8")) as Record<
    string,
    unknown
  >;
  manifestRaw.reconciledAt = "2026-07-30T02:00:00.000Z";
  writeFileSync(join(missionDir, "mission.yaml"), JSON.stringify(manifestRaw, null, 2) + "\n");
  const head = execSync("git rev-parse HEAD", { cwd: workpiece, encoding: "utf-8" }).trim();
  write(
    missionDir,
    "evidence/reconciliation-report.json",
    JSON.stringify({ workpieceHeadAtReconcile: head }) + "\n",
  );
  gitInit(testRoot);
  write(
    cacheClone,
    "system-config.yaml",
    `schemaVersion: system-config/v1\nid: ${SITE}\ncosmicStar: Vega\nmirrors:\n  - path: "../systems-cache/${SITE}"\n    storageType: non-bare\npinnedPlatform: "1.0.0"\nstatus: active\nregisteredAt: "2026-01-01T00:00:00Z"\nnotes: ""\n`,
  );
  write(cacheClone, "system.pin.json", JSON.stringify({ platform: { version: "1.0.0" } }));
  mkdirSync(join(cacheClone, "bordbuch"), { recursive: true });
  write(cacheClone, "bordbuch/events.ndjson", "");
  gitCommitAll(testRoot, "fixture baseline");
  // Close delegates several steps (template sync, pin, claims, sync) through
  // executeKernelCommand — everything is green in this fixture.
  mockExecuteKernelCommand.mockImplementation(async () => ({ exitCode: 0, data: {} }));

  const res = await runMissionClose(
    makeInput({
      mission: MISSION,
      actor: "test-agent",
      "allow-no-op": true,
      "skip-reconcile-check": true,
      "skip-auto-sync": true,
      "skip-evidence-sync": true,
    }),
    makeContext(),
  );
  expect(res.exitCode).toBe(0);

  expect(mockRunMissionValidate).not.toHaveBeenCalled();
  const closeCall = (mockAppendBordbuch.mock.calls as unknown as unknown[][]).find(
    (c) => c[2] === "mission-close" && (c[3] as string).includes("closed"),
  );
  expect(closeCall).toBeDefined();
  expect((closeCall![5] as { metadata?: { lane?: string } }).metadata?.lane).toBe("fast");
  expect(res.data?.state).toBe("closed");
});
