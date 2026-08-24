/*
<MODULE_CONTRACT>
  <purpose>
    RFC-0656: unit tests for dist.determinism.validate — tests flag validation,
    release dist, mission workpiece dist, missing dist, and non-deterministic file detection.
  </purpose>
  <keywords>RFC-0656, dist.determinism.validate, determinism, stable hash</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0656: initial dist.determinism.validate tests covering flag validation, release/mission dist resolution, and non-deterministic file detection.</item>
</CHANGE_SUMMARY>
*/

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";

vi.mock("../mission/mission-io.ts", () => ({
  readMissionManifest: vi.fn(),
  writeMissionManifest: vi.fn(),
  resolveMissionDir: vi.fn((workspaceRoot: string, missionId: string) =>
    join(workspaceRoot, "missions", missionId),
  ),
}));

import { runDistDeterminismValidate } from "../release/release-commands.ts";
import { expectData } from "./helpers/kernel-result-helpers.ts";

let tmpDir: string;

function makeInput(flags: Record<string, string>): KernelCommandInput {
  return { argv: [], flags };
}

function makeContext(workspaceRoot: string): KernelRuntimeContext {
  return {
    workspaceRoot,
    logger: { info: () => {}, warn: () => {}, success: () => {}, error: () => {} },
  } as unknown as KernelRuntimeContext;
}

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "dist-determinism-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("dist.determinism.validate flag validation", () => {
  it("throws if neither --release nor --mission is provided", async () => {
    await expect(runDistDeterminismValidate(makeInput({}), makeContext(tmpDir))).rejects.toThrow(
      "either --release or --mission is required",
    );
  });

  it("throws if both --release and --mission are provided", async () => {
    await expect(
      runDistDeterminismValidate(
        makeInput({ release: "r001", mission: "m001" }),
        makeContext(tmpDir),
      ),
    ).rejects.toThrow("mutually exclusive");
  });
});

describe("dist.determinism.validate with --release", () => {
  it("returns exitCode 1 if dist directory does not exist", async () => {
    const result = await runDistDeterminismValidate(
      makeInput({ release: "test-sys-r000001" }),
      makeContext(tmpDir),
    );
    expect(result.exitCode).toBe(1);
    expect(expectData(result).totalFiles).toBe(0);
  });

  it("detects deterministic files (all match)", async () => {
    const distDir = join(tmpDir, "releases", "test-sys-r000001", "dist");
    await mkdir(distDir, { recursive: true });
    await writeFile(join(distDir, "index.html"), "<html><body>Hello</body></html>");
    await writeFile(join(distDir, "style.css"), "body { color: red; }");

    const result = await runDistDeterminismValidate(
      makeInput({ release: "test-sys-r000001" }),
      makeContext(tmpDir),
    );

    expect(expectData(result).hashesMatch).toBe(true);
    expect(expectData(result).nonDeterministicFiles).toHaveLength(0);
    expect(expectData(result).totalFiles).toBe(2);
    expect(result.exitCode).toBeUndefined();
  });

  it("detects non-deterministic JSON with timestamp fields", async () => {
    const distDir = join(tmpDir, "releases", "test-sys-r000001", "dist");
    await mkdir(distDir, { recursive: true });
    await writeFile(
      join(distDir, "build-identity.json"),
      JSON.stringify({ releaseId: "r001", createdAt: "2026-01-01T00:00:00Z" }),
    );

    const result = await runDistDeterminismValidate(
      makeInput({ release: "test-sys-r000001" }),
      makeContext(tmpDir),
    );

    expect(expectData(result).hashesMatch).toBe(false);
    expect(expectData(result).nonDeterministicFiles.length).toBeGreaterThan(0);
    expect(expectData(result).nonDeterministicFiles[0]!.normalizer).toBe("json-stable");
    expect(result.exitCode).toBe(1);
  });
});

describe("dist.determinism.validate with --mission", () => {
  it("returns exitCode 1 if no dist directory exists for mission", async () => {
    const result = await runDistDeterminismValidate(
      makeInput({ mission: "test-sys-m000001" }),
      makeContext(tmpDir),
    );
    expect(result.exitCode).toBe(1);
    expect(expectData(result).totalFiles).toBe(0);
  });

  it("validates workpiece dist when it exists", async () => {
    const distDir = join(tmpDir, "missions", "test-sys-m000001", "workpiece", "dist");
    await mkdir(distDir, { recursive: true });
    await writeFile(join(distDir, "index.html"), "<html></html>");

    const result = await runDistDeterminismValidate(
      makeInput({ mission: "test-sys-m000001" }),
      makeContext(tmpDir),
    );

    expect(expectData(result).distPath).toContain("workpiece");
    expect(expectData(result).totalFiles).toBe(1);
    expect(expectData(result).hashesMatch).toBe(true);
  });

  it("falls back to distribution dist when workpiece dist does not exist", async () => {
    const distDir = join(tmpDir, "missions", "test-sys-m000001", "distribution", "dist");
    await mkdir(distDir, { recursive: true });
    await writeFile(join(distDir, "index.html"), "<html></html>");

    const result = await runDistDeterminismValidate(
      makeInput({ mission: "test-sys-m000001" }),
      makeContext(tmpDir),
    );

    expect(expectData(result).distPath).toContain("distribution");
    expect(expectData(result).totalFiles).toBe(1);
  });
});
