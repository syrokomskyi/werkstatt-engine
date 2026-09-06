/*
<MODULE_CONTRACT>
<purpose>RFC-0555: tests for workpiece.write command handler.</purpose>
<keywords>RFC-0555, workpiece, write, DNA-22, stdin, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0555: initial unit tests for workpiece.write.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { runWorkpieceWrite } from "../workpiece/workpiece-write.ts";
import { tmpdir } from "node:os";
import type {
  KernelCommandInput,
  KernelRuntimeContext,
  KernelFlagValue,
} from "@warpgogol/werkstatt-engine/kernel";

let tmpDir: string;
let workpieceDir: string;

function setupMission(clientEditable: string[]): string {
  tmpDir = mkdtempSync(join(tmpdir(), "tmp-wp-write-test-"));
  const missionDir = join(tmpDir, "missions", "test-mission");
  workpieceDir = join(missionDir, "workpiece");
  const contentDir = join(workpieceDir, "src", "content");
  mkdirSync(contentDir, { recursive: true });
  mkdirSync(join(contentDir, "pages"), { recursive: true });

  const frontmatter = `---\napp: test-app\nversion: 1.0.0\nidentity:\n  systemStar: test\n  biome: default\n  tagline: test\nconstellations:\n  - test\nclientEditable:\n${clientEditable.map((e) => `  - ${e}`).join("\n")}\npages: []\ngrowth:\n  vendor:\n    adapter: null\n    options: {}\n  funnels: []\n  experiments: []\nrelease:\n  passport:\n    enabled: false\n    indexable: false\n    keyVersion: "1"\n    heartbeatUrl: ""\n---\n\n# Test\n`;
  writeFileSync(join(contentDir, "system.md"), frontmatter);
  writeFileSync(join(contentDir, "pages", "home.md"), "# Home");

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

function mockStdin(content: string): void {
  const stream = Readable.from([content]);
  Object.defineProperty(stream, "isTTY", { value: false });
  Object.defineProperty(process, "stdin", {
    value: stream,
    writable: true,
    configurable: true,
  });
}

beforeEach(() => {
  setupMission(["pages", "prose"]);
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

test("workpiece.write writes a file inside clientEditable surface via stdin", async () => {
  mockStdin("# Updated Home Page");
  const result = await runWorkpieceWrite(
    makeInput({ mission: "test-mission", path: "src/content/pages/home.md", stdin: true }),
    makeContext(),
  );
  expect(result.data?.bytesWritten).toBeGreaterThan(0);
  const written = readFileSync(join(workpieceDir, "src", "content", "pages", "home.md"), "utf8");
  expect(written).toBe("# Updated Home Page");
});

test("workpiece.write rejects path outside clientEditable surface", async () => {
  mockStdin("content");
  await expect(
    runWorkpieceWrite(
      makeInput({ mission: "test-mission", path: "src/content/system.md", stdin: true }),
      makeContext(),
    ),
  ).rejects.toThrow("DNA-22");
});

test("workpiece.write rejects path traversal", async () => {
  mockStdin("content");
  await expect(
    runWorkpieceWrite(
      makeInput({ mission: "test-mission", path: "../../etc/passwd", stdin: true }),
      makeContext(),
    ),
  ).rejects.toThrow();
});

test("workpiece.write rejects when mission does not exist", async () => {
  mockStdin("content");
  await expect(
    runWorkpieceWrite(
      makeInput({ mission: "nonexistent", path: "src/content/pages/home.md", stdin: true }),
      makeContext(),
    ),
  ).rejects.toThrow("not open or does not exist");
});

test("workpiece.write rejects when --mission flag is missing", async () => {
  mockStdin("content");
  await expect(
    runWorkpieceWrite(makeInput({ path: "src/content/pages/home.md", stdin: true }), makeContext()),
  ).rejects.toThrow("--mission flag is required");
});

test("workpiece.write creates parent directories if needed", async () => {
  mockStdin("# New Page");
  const result = await runWorkpieceWrite(
    makeInput({ mission: "test-mission", path: "src/content/pages/new/new-page.md", stdin: true }),
    makeContext(),
  );
  expect(result.data?.bytesWritten).toBeGreaterThan(0);
  const written = readFileSync(
    join(workpieceDir, "src", "content", "pages", "new", "new-page.md"),
    "utf8",
  );
  expect(written).toBe("# New Page");
});

test("workpiece.write does not auto-commit (file is left dirty)", async () => {
  mockStdin("# Modified Home");
  await runWorkpieceWrite(
    makeInput({ mission: "test-mission", path: "src/content/pages/home.md", stdin: true }),
    makeContext(),
  );
  const content = readFileSync(join(workpieceDir, "src", "content", "pages", "home.md"), "utf8");
  expect(content).toBe("# Modified Home");
});
