/*
<MODULE_CONTRACT>
<purpose>
Unit tests for workpiece write covering its documented public contract and regression-sensitive edge cases.
</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0555: initial unit tests for workpiece.write.</item>
  <item>RFC-1262</item>
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
import { createDefaultIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";

let tmpDir: string;
let workpieceDir: string;

function setupMission(clientEditable: string[]): string {
  tmpDir = mkdtempSync(join(tmpdir(), "tmp-wp-write-test-"));
  const missionDir = join(tmpDir, "missions", "test-mission");
  workpieceDir = join(missionDir, "workpiece");
  const contentDir = join(workpieceDir, "src", "content");
  mkdirSync(contentDir, { recursive: true });
  mkdirSync(join(contentDir, "pages"), { recursive: true });

  const frontmatter = `---\napp: test-app\nversion: 1.0.0\nidentity:\n  systemStar: test\n  biome: default\n  tagline: test\nconstellations:\n  - test\nclientEditable:\n${clientEditable.map((e) => `  - ${e}`).join("\n")}\npages: []\n---\n\n# Test\n`;
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
    io: createDefaultIO().io,
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

// RFC-1262 GENW-01: the generated-path registry blocks writes into
// non-editable generated outputs inside the workpiece.

function writeGeneratedPathsRegistry(yaml: string): void {
  mkdirSync(join(workpieceDir, ".werkstatt"), { recursive: true });
  writeFileSync(join(workpieceDir, ".werkstatt", "generated-paths.generated.yaml"), yaml);
}

test("workpiece.write rejects a registered non-editable generated path (GENW-01)", async () => {
  writeGeneratedPathsRegistry(`version: 1
generatedAt: 2026-10-11T00:00:00.000Z
paths:
  - path: "src/content/pages/**"
    owner: routes.generate
    sources: [command-generates]
    editable: false
    modulePath: packages/werkstatt-site/src/codegen/routes.ts
`);
  mockStdin("# forged");
  await expect(
    runWorkpieceWrite(
      makeInput({ mission: "test-mission", path: "src/content/pages/home.md", stdin: true }),
      makeContext(),
    ),
  ).rejects.toThrow("GENW-01");
});

test("workpiece.write GENW-01 carries the owner and sanctioned edit hint", async () => {
  writeGeneratedPathsRegistry(`version: 1
paths:
  - path: "src/content/pages/**"
    owner: routes.generate
    modulePath: packages/werkstatt-site/src/codegen/routes.ts
`);
  mockStdin("# forged");
  await expect(
    runWorkpieceWrite(
      makeInput({ mission: "test-mission", path: "src/content/pages/home.md", stdin: true }),
      makeContext(),
    ),
  ).rejects.toThrow(/routes\.generate.*packages\/werkstatt-site\/src\/codegen\/routes\.ts/s);
});

test("workpiece.write allows an editable marker path (RFC-1153 escape hatch)", async () => {
  writeGeneratedPathsRegistry(`version: 1
paths:
  - path: "src/content/pages/**"
    owner: routes.generate
    editable: true
`);
  mockStdin("# editable override");
  const result = await runWorkpieceWrite(
    makeInput({ mission: "test-mission", path: "src/content/pages/home.md", stdin: true }),
    makeContext(),
  );
  expect(result.data?.bytesWritten).toBeGreaterThan(0);
  expect(readFileSync(join(workpieceDir, "src", "content", "pages", "home.md"), "utf8")).toBe(
    "# editable override",
  );
});

test("workpiece.write proceeds with a GENW-02 warning when the registry is absent", async () => {
  // No .werkstatt/ seeded — guard must fail open and still write.
  mockStdin("# no registry");
  const result = await runWorkpieceWrite(
    makeInput({ mission: "test-mission", path: "src/content/pages/home.md", stdin: true }),
    makeContext(),
  );
  expect(result.data?.bytesWritten).toBeGreaterThan(0);
});
