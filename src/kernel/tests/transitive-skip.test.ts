import { test, expect, describe, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  shouldTransitiveSkip,
  loadImportedCacheHits,
  persistCacheHits,
  clearPipelineCacheHits,
  type PipelineRunState,
} from "../runtime/execute-pipeline.ts";
import type { KernelCommandDefinition } from "../types.ts";

/*
<MODULE_CONTRACT>
  <purpose>
    RFC-0687: Unit tests for transitive cache skip logic — shouldTransitiveSkip,
    loadImportedCacheHits, persistCacheHits, clearPipelineCacheHits.
    Covers all 10 acceptance criteria test cases (a)-(j).
  </purpose>
</MODULE_CONTRACT>
*/

function makeCommand(overrides: Partial<KernelCommandDefinition> = {}): KernelCommandDefinition {
  return {
    name: "test.validate",
    description: "Test validator",
    scope: "workspace",
    execute: () => undefined,
    ...overrides,
  };
}

function makeRunState(commands: string[] = []): PipelineRunState {
  return {
    cacheHitCommands: new Set(commands),
    pipelineName: "build.check",
  };
}

describe("RFC-0687: shouldTransitiveSkip", () => {
  test("(a) transitive skip fires when all upstream cached", () => {
    const cmd = makeCommand({
      name: "validator.a",
      validatesOutputs: ["generator.x", "generator.y"],
      reads: ["src/**/*.ts"],
    });
    const state = makeRunState(["generator.x", "generator.y"]);
    expect(shouldTransitiveSkip(cmd, state)).toBe(true);
  });

  test("(b) no skip when upstream cache miss", () => {
    const cmd = makeCommand({
      name: "validator.a",
      validatesOutputs: ["generator.x", "generator.y"],
      reads: ["src/**/*.ts"],
    });
    const state = makeRunState(["generator.x"]);
    expect(shouldTransitiveSkip(cmd, state)).toBe(false);
  });

  test("(c) no skip for cacheable: false validators", () => {
    const cmd = makeCommand({
      name: "validator.a",
      validatesOutputs: ["generator.x"],
      cacheable: false,
    });
    const state = makeRunState(["generator.x"]);
    expect(shouldTransitiveSkip(cmd, state)).toBe(false);
  });

  test("(d) transitive skip through a chain of 2 validators", () => {
    const validatorA = makeCommand({
      name: "validator.a",
      validatesOutputs: ["generator.g"],
      reads: ["src/**/*.ts"],
    });
    const validatorB = makeCommand({
      name: "validator.b",
      validatesOutputs: ["generator.g", "validator.a"],
      reads: ["src/**/*.ts"],
    });
    const state = makeRunState(["generator.g", "validator.a"]);
    expect(shouldTransitiveSkip(validatorA, state)).toBe(true);
    expect(shouldTransitiveSkip(validatorB, state)).toBe(true);
  });

  test("(e) --force disables transitive skip (empty cacheHitCommands)", () => {
    const cmd = makeCommand({
      name: "validator.a",
      validatesOutputs: ["generator.x"],
      reads: ["src/**/*.ts"],
    });
    const state = makeRunState([]);
    expect(shouldTransitiveSkip(cmd, state)).toBe(false);
  });

  test("(h) no skip when validatesOutputs is empty or undefined", () => {
    const cmdWithEmpty = makeCommand({
      name: "validator.a",
      validatesOutputs: [],
      reads: ["src/**/*.ts"],
    });
    const cmdWithout = makeCommand({
      name: "validator.b",
      reads: ["src/**/*.ts"],
    });
    const state = makeRunState(["generator.x"]);
    expect(shouldTransitiveSkip(cmdWithEmpty, state)).toBe(false);
    expect(shouldTransitiveSkip(cmdWithout, state)).toBe(false);
  });
});

describe("RFC-0687: loadImportedCacheHits", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rfc0687-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("(f) stale entries (>30 min) are ignored", async () => {
    const staleTimestamp = Date.now() - 31 * 60 * 1000;
    const data = {
      pipelines: {
        "build.prepare": {
          commands: ["stale.generator"],
          writtenAt: staleTimestamp,
        },
      },
    };
    await mkdir(join(tempDir, ".cache"), { recursive: true });
    await writeFile(
      join(tempDir, ".cache", "pipeline-cache-hits.json"),
      JSON.stringify(data),
      "utf8",
    );

    const hits = await loadImportedCacheHits(tempDir, "build.check");
    expect(hits.size).toBe(0);
  });

  test("(g) cross-pipeline skip works — entries from other pipelines merged", async () => {
    const freshTimestamp = Date.now() - 5 * 60 * 1000;
    const data = {
      pipelines: {
        "build.prepare": {
          commands: ["generator.x", "generator.y"],
          writtenAt: freshTimestamp,
        },
      },
    };
    await mkdir(join(tempDir, ".cache"), { recursive: true });
    await writeFile(
      join(tempDir, ".cache", "pipeline-cache-hits.json"),
      JSON.stringify(data),
      "utf8",
    );

    const hits = await loadImportedCacheHits(tempDir, "build.check");
    expect(hits.has("generator.x")).toBe(true);
    expect(hits.has("generator.y")).toBe(true);
    expect(hits.size).toBe(2);
  });

  test("(i) corrupt JSON falls back to empty set", async () => {
    await mkdir(join(tempDir, ".cache"), { recursive: true });
    await writeFile(
      join(tempDir, ".cache", "pipeline-cache-hits.json"),
      "{ not valid json",
      "utf8",
    );

    const hits = await loadImportedCacheHits(tempDir, "build.check");
    expect(hits.size).toBe(0);
  });

  test("missing file returns empty set", async () => {
    const hits = await loadImportedCacheHits(tempDir, "build.check");
    expect(hits.size).toBe(0);
  });

  test("current pipeline entries are excluded", async () => {
    const freshTimestamp = Date.now();
    const data = {
      pipelines: {
        "build.check": {
          commands: ["self.generator"],
          writtenAt: freshTimestamp,
        },
        "build.prepare": {
          commands: ["other.generator"],
          writtenAt: freshTimestamp,
        },
      },
    };
    await mkdir(join(tempDir, ".cache"), { recursive: true });
    await writeFile(
      join(tempDir, ".cache", "pipeline-cache-hits.json"),
      JSON.stringify(data),
      "utf8",
    );

    const hits = await loadImportedCacheHits(tempDir, "build.check");
    expect(hits.has("other.generator")).toBe(true);
    expect(hits.has("self.generator")).toBe(false);
  });
});

describe("RFC-0687: persistCacheHits", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rfc0687-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("(j) persistCacheHits preserves entries for other pipelines", async () => {
    const initialData = {
      pipelines: {
        "build.prepare": {
          commands: ["prep.generator"],
          writtenAt: Date.now(),
        },
      },
    };
    await mkdir(join(tempDir, ".cache"), { recursive: true });
    await writeFile(
      join(tempDir, ".cache", "pipeline-cache-hits.json"),
      JSON.stringify(initialData),
      "utf8",
    );

    await persistCacheHits(tempDir, "build.check", new Set(["check.validator"]));

    const raw = await readFile(join(tempDir, ".cache", "pipeline-cache-hits.json"), "utf8");
    const data = JSON.parse(raw);
    expect(data.pipelines["build.prepare"].commands).toContain("prep.generator");
    expect(data.pipelines["build.check"].commands).toContain("check.validator");
  });

  test("persistCacheHits creates file when missing", async () => {
    await persistCacheHits(tempDir, "build.check", new Set(["new.command"]));

    const raw = await readFile(join(tempDir, ".cache", "pipeline-cache-hits.json"), "utf8");
    const data = JSON.parse(raw);
    expect(data.pipelines["build.check"].commands).toContain("new.command");
  });

  test("persistCacheHits overwrites same pipeline entry", async () => {
    const initialData = {
      pipelines: {
        "build.check": {
          commands: ["old.command"],
          writtenAt: Date.now() - 1000,
        },
      },
    };
    await mkdir(join(tempDir, ".cache"), { recursive: true });
    await writeFile(
      join(tempDir, ".cache", "pipeline-cache-hits.json"),
      JSON.stringify(initialData),
      "utf8",
    );

    await persistCacheHits(tempDir, "build.check", new Set(["new.command"]));

    const raw = await readFile(join(tempDir, ".cache", "pipeline-cache-hits.json"), "utf8");
    const data = JSON.parse(raw);
    expect(data.pipelines["build.check"].commands).toEqual(["new.command"]);
  });
});

describe("RFC-0687: clearPipelineCacheHits", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rfc0687-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("clear empties all pipeline entries", async () => {
    const initialData = {
      pipelines: {
        "build.prepare": {
          commands: ["prep.generator"],
          writtenAt: Date.now(),
        },
        "build.check": {
          commands: ["check.validator"],
          writtenAt: Date.now(),
        },
      },
    };
    await mkdir(join(tempDir, ".cache"), { recursive: true });
    await writeFile(
      join(tempDir, ".cache", "pipeline-cache-hits.json"),
      JSON.stringify(initialData),
      "utf8",
    );

    await clearPipelineCacheHits(tempDir);

    const raw = await readFile(join(tempDir, ".cache", "pipeline-cache-hits.json"), "utf8");
    const data = JSON.parse(raw);
    expect(Object.keys(data.pipelines)).toHaveLength(0);
  });

  test("clear creates empty file when missing", async () => {
    await clearPipelineCacheHits(tempDir);

    const raw = await readFile(join(tempDir, ".cache", "pipeline-cache-hits.json"), "utf8");
    const data = JSON.parse(raw);
    expect(data.pipelines).toEqual({});
  });
});
