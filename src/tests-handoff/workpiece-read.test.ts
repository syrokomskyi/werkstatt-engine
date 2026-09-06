/*
<MODULE_CONTRACT>
<purpose>RFC-0555: tests for workpiece.read command handler.</purpose>
<keywords>RFC-0555, workpiece, read, DNA-22, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0555: initial unit tests for workpiece.read.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runWorkpieceRead } from "../workpiece/workpiece-read.ts";
import { tmpdir } from "node:os";
import type {
  KernelCommandInput,
  KernelRuntimeContext,
  KernelFlagValue,
} from "@warpgogol/werkstatt-engine/kernel";

let tmpDir: string;
let workpieceDir: string;

function setupMission(clientEditable: string[]): string {
  tmpDir = mkdtempSync(join(tmpdir(), "tmp-wp-read-test-"));
  const missionDir = join(tmpDir, "missions", "test-mission");
  workpieceDir = join(missionDir, "workpiece");
  const contentDir = join(workpieceDir, "src", "content");
  mkdirSync(contentDir, { recursive: true });
  mkdirSync(join(contentDir, "pages"), { recursive: true });

  const frontmatter = `---\napp: test-app\nversion: 1.0.0\nidentity:\n  systemStar: test\n  biome: default\n  tagline: test\nconstellations:\n  - test\nclientEditable:\n${clientEditable.map((e) => `  - ${e}`).join("\n")}\npages: []\ngrowth:\n  vendor:\n    adapter: null\n    options: {}\n  funnels: []\n  experiments: []\nrelease:\n  passport:\n    enabled: false\n    indexable: false\n    keyVersion: "1"\n    heartbeatUrl: ""\n---\n\n# Test\n`;
  writeFileSync(join(contentDir, "system.md"), frontmatter);
  writeFileSync(join(contentDir, "pages", "home.md"), "# Home Page");

  const missionManifest = `schemaVersion: "1.0.0"
missionId: test-system-m000001
systemId: test-system
state: open
brief: test
openedAt: 2026-01-01T00:00:00.000Z
openedBy: agent
closedAt: null
closedBy: null
pinAtOpen: v1.0.0
materializedAt: null
reconciledAt: null
migratedAt: null
releaseId: null
rfcId: null
operationId: op-000001
`;
  mkdirSync(missionDir, { recursive: true });
  writeFileSync(join(missionDir, "mission.yaml"), missionManifest);

  return tmpDir;
}

function makeContext(): KernelRuntimeContext {
  return {
    workspaceRoot: tmpDir,
    siteExplicit: false,
    logger: {
      section: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      success: () => {},
      event: () => {},
      getEvents: () => [],
    },
    dryRun: false,
    outputFormat: "json",
    io: {} as never,
    actualState: undefined as never,
  };
}

function makeInput(flags: Record<string, KernelFlagValue>): KernelCommandInput {
  return { argv: [], flags };
}

beforeEach(() => {
  setupMission(["pages", "prose"]);
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

test("workpiece.read reads a file inside clientEditable surface", async () => {
  const result = await runWorkpieceRead(
    makeInput({ mission: "test-mission", path: "src/content/pages/home.md" }),
    makeContext(),
  );
  expect(result.data?.content).toBe("# Home Page");
  expect(result.data?.path).toBe("src/content/pages/home.md");
});

test("workpiece.read rejects path outside clientEditable surface", async () => {
  await expect(
    runWorkpieceRead(
      makeInput({ mission: "test-mission", path: "src/content/system.md" }),
      makeContext(),
    ),
  ).rejects.toThrow("DNA-22");
});

test("workpiece.read rejects path traversal", async () => {
  await expect(
    runWorkpieceRead(
      makeInput({ mission: "test-mission", path: "../../packages/studio-gate/src/index.ts" }),
      makeContext(),
    ),
  ).rejects.toThrow();
});

test("workpiece.read rejects when mission does not exist", async () => {
  await expect(
    runWorkpieceRead(
      makeInput({ mission: "nonexistent", path: "src/content/pages/home.md" }),
      makeContext(),
    ),
  ).rejects.toThrow("not open or does not exist");
});

test("workpiece.read rejects when workpiece not materialized", async () => {
  const missionDir = join(tmpDir, "missions", "empty-mission");
  mkdirSync(missionDir, { recursive: true });
  writeFileSync(
    join(missionDir, "mission.yaml"),
    'schemaVersion: "1.0.0"\nmissionId: test-system-m000002\nsystemId: test-system\nstate: open\nbrief: test\nopenedAt: 2026-01-01T00:00:00.000Z\nopenedBy: agent\nclosedAt: null\nclosedBy: null\npinAtOpen: v1.0.0\nmaterializedAt: null\nreconciledAt: null\nmigratedAt: null\nreleaseId: null\nrfcId: null\noperationId: op-000002\n',
  );

  await expect(
    runWorkpieceRead(
      makeInput({ mission: "empty-mission", path: "src/content/pages/home.md" }),
      makeContext(),
    ),
  ).rejects.toThrow("mission.materialize first");
});

test("workpiece.read rejects when file does not exist", async () => {
  await expect(
    runWorkpieceRead(
      makeInput({ mission: "test-mission", path: "src/content/pages/nonexistent.md" }),
      makeContext(),
    ),
  ).rejects.toThrow("File not found");
});

test("workpiece.read rejects when --mission flag is missing", async () => {
  await expect(
    runWorkpieceRead(makeInput({ path: "src/content/pages/home.md" }), makeContext()),
  ).rejects.toThrow("--mission flag is required");
});

test("workpiece.read rejects when --path flag is missing", async () => {
  await expect(
    runWorkpieceRead(makeInput({ mission: "test-mission" }), makeContext()),
  ).rejects.toThrow("--path flag is required");
});
