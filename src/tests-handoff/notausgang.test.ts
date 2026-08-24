/*
<MODULE_CONTRACT>
<purpose>RFC-0380: integration tests for notausgang.export and notausgang.validate deep integrity verification.</purpose>
<non-goals>
  <item>Do not test @warpgogol/fingerprint internals — those have their own test suite.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0380: initial notausgang export/validate integration tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { runNotausgangExport } from "../notausgang/notausgang-commands.ts";
import { runNotausgangValidate } from "../notausgang/notausgang-commands.ts";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";
import { expectData } from "./helpers/kernel-result-helpers.ts";

let testRoot: string;
let workspaceRoot: string;

function makeInput(flags: Record<string, unknown>): KernelCommandInput {
  return {
    flags: flags as Record<string, import("@warpgogol/werkstatt-engine/kernel").KernelFlagValue>,
    argv: [],
  };
}

function makeContext(root: string): KernelRuntimeContext {
  return {
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

async function setupRelease(root: string, systemId: string, releaseId: string): Promise<void> {
  const workspace = join(root, "workspace");
  const releaseDir = join(workspace, "releases", releaseId);
  await mkdir(releaseDir, { recursive: true });

  const releaseManifest = `state: ready
platformVersion: 4.5.0
platformSemanticHash: sha256:abc123
semver: 4.5.0
distArtifactHash: sha256:dist-abc
siteContentHash: sha256:site-abc
behaviorSnapshotHash: sha256:snap-abc
`;
  await writeFile(join(releaseDir, "release.yaml"), releaseManifest, "utf8");

  const distDir = join(releaseDir, "dist");
  await mkdir(distDir, { recursive: true });
  await writeFile(join(distDir, "index.html"), "<html><body>test</body></html>\n", "utf8");

  const artifactManifest = { artifacts: [{ name: "dist", hash: "sha256:abc" }] };
  await writeFile(
    join(releaseDir, "artifact-manifest.json"),
    JSON.stringify(artifactManifest, null, 2),
    "utf8",
  );

  const bordbuchDir = join(root, "systems-cache", systemId, "bordbuch");
  await mkdir(bordbuchDir, { recursive: true });
  const bordbuchLine = (kind: string) =>
    JSON.stringify({
      schemaVersion: "1.0.0",
      id: `event-${kind === "release" ? "000001" : "000002"}`,
      systemId,
      occurredAt: "2026-07-12T10:00:00.000Z",
      kind,
      status: "done",
      missionId: null,
      releaseId: null,
      actor: "agent",
      summary: `${kind} event`,
      metadata: {},
      previousHash: null,
      hash: `sha256:${kind === "release" ? "aaa" : "bbb"}`,
    });
  await writeFile(
    join(bordbuchDir, "events.ndjson"),
    `${bordbuchLine("release")}\n${bordbuchLine("mission")}\n`,
    "utf8",
  );

  const pin = {
    schemaVersion: "1.0.0",
    systemId,
    cosmicStar: "Vega",
    pinnedAt: "2026-07-12T10:00:00.000Z",
    platform: {
      version: "4.5.0",
      commit: "0000000",
      rfcHead: "RFC-0000",
      platformSemanticHash: "sha256:abc",
    },
    migratorCursor: "4.5.0",
    capabilities: [],
  };
  await writeFile(
    join(root, "systems-cache", systemId, "system.pin.json"),
    JSON.stringify(pin, null, 2),
    "utf8",
  );

  await writeFile(join(releaseDir, "readable-snapshot.json"), '{"version":"1.0"}\n', "utf8");
  await writeFile(join(releaseDir, "production-snapshot.json"), '{"version":"1.0"}\n', "utf8");
  await writeFile(join(releaseDir, "snapshot-diff.json"), '{"diff":[]}\n', "utf8");

  const siteContentDir = join(workspace, "apps", systemId, "src", "content");
  await mkdir(siteContentDir, { recursive: true });
  await writeFile(join(siteContentDir, "test.md"), "# Test\n", "utf8");
  await writeFile(
    join(workspace, "apps", systemId, "package.json"),
    JSON.stringify({ name: "test-bundle", version: "1.0.0" }),
    "utf8",
  );
}

beforeEach(async () => {
  testRoot = await mkdtemp(join(tmpdir(), "notausgang-test-"));
  workspaceRoot = join(testRoot, "workspace");
  await mkdir(workspaceRoot, { recursive: true });
  const cacheDir = join(testRoot, "systems-cache", "test-bundle");
  await mkdir(cacheDir, { recursive: true });
  await writeFile(
    join(cacheDir, "system-config.yaml"),
    stringifyYaml({
      schemaVersion: "system-config/v1",
      id: "test-bundle",
      cosmicStar: "Vega",
      status: "active",
      mirrors: [{ path: "../systems-cache/test-bundle", storageType: "non-bare" }],
      pinnedPlatform: "4.5.0",
      registeredAt: "2026-07-12T10:00:00.000Z",
      notes: "",
    }) + "\n",
    "utf8",
  );
  await mkdir(join(workspaceRoot, "docs", "rfcs"), { recursive: true });
  await writeFile(join(workspaceRoot, "docs", "rfcs", "RFC-0001-test.md"), "", "utf8");
  await writeFile(
    join(workspaceRoot, "package.json"),
    JSON.stringify({ version: "4.5.0" }),
    "utf8",
  );
  await mkdir(join(workspaceRoot, "packages", "dummy"), { recursive: true });
  await writeFile(
    join(workspaceRoot, "packages", "dummy", "index.ts"),
    "export const x = 1;\n",
    "utf8",
  );
  await setupRelease(testRoot, "test-bundle", "test-bundle-r202607");
});

afterEach(async () => {
  await rm(testRoot, { recursive: true, force: true });
});

test("export writes YAML artifacts (not JSON)", async () => {
  const outputDir = join(workspaceRoot, "notausgang-export");

  const result = await runNotausgangExport(
    makeInput({
      system: "test-bundle",
      release: "test-bundle-r202607",
      output: "notausgang-export",
    }),
    makeContext(workspaceRoot),
  );

  expect(expectData(result).systemId).toBe("test-bundle");
  expect(existsSync(join(outputDir, "notausgang-manifest.yaml"))).toBe(true);
  expect(existsSync(join(outputDir, "notausgang-manifest.json"))).toBe(false);
  expect(existsSync(join(outputDir, "system.pin.yaml"))).toBe(true);
  expect(existsSync(join(outputDir, "system.pin.json"))).toBe(false);
  expect(existsSync(join(outputDir, "artifact-manifest.yaml"))).toBe(true);
  expect(existsSync(join(outputDir, "artifact-manifest.json"))).toBe(false);
});

test("export hashes use sha256: prefix from @warpgogol/werkstatt-engine/fingerprint", async () => {
  const result = await runNotausgangExport(
    makeInput({
      system: "test-bundle",
      release: "test-bundle-r202607",
      output: "notausgang-export",
    }),
    makeContext(workspaceRoot),
  );

  expect(expectData(result).distHash).toMatch(/^sha256:/);
  expect(expectData(result).siteHash).toMatch(/^sha256:/);
  expect(expectData(result).bordbuchHash).toMatch(/^sha256:/);
});

test("validate passes on a valid export package", async () => {
  await runNotausgangExport(
    makeInput({
      system: "test-bundle",
      release: "test-bundle-r202607",
      output: "notausgang-export",
    }),
    makeContext(workspaceRoot),
  );

  const result = await runNotausgangValidate(
    makeInput({ path: "notausgang-export" }),
    makeContext(workspaceRoot),
  );

  expect(result.exitCode).toBe(0);
  expect(expectData(result).violations).toHaveLength(0);
  expect(expectData(result).manifest).toBe("valid");
  expect(expectData(result).dist).toBe("valid");
  expect(expectData(result).site).toBe("valid");
  expect(expectData(result).bordbuch).toBe("valid");
  expect(expectData(result).pin).toBe("valid");
  expect(expectData(result).snapshots).toBe("valid");
  expect(expectData(result).artifactManifest).toBe("valid");
  expect(expectData(result).distHashMatch).toBe(true);
  expect(expectData(result).siteHashMatch).toBe(true);
  expect(expectData(result).bordbuchHashMatch).toBe(true);
  expect(expectData(result).snapshotHashMatch).toBe(true);
  expect(expectData(result).artifactHashMatch).toBe(true);
});

test("validate fails on dist hash mismatch (tampered dist file)", async () => {
  await runNotausgangExport(
    makeInput({
      system: "test-bundle",
      release: "test-bundle-r202607",
      output: "notausgang-export",
    }),
    makeContext(workspaceRoot),
  );

  const distFile = join(workspaceRoot, "notausgang-export", "dist", "index.html");
  await writeFile(distFile, "<html><body>tampered</body></html>\n", "utf8");

  const result = await runNotausgangValidate(
    makeInput({ path: "notausgang-export" }),
    makeContext(workspaceRoot),
  );

  expect(result.exitCode).toBe(1);
  expect(expectData(result).violations.some((v) => v.rule === "dist-hash-mismatch")).toBe(true);
});

test("validate fails on manifest schema violation (corrupted manifest)", async () => {
  await runNotausgangExport(
    makeInput({
      system: "test-bundle",
      release: "test-bundle-r202607",
      output: "notausgang-export",
    }),
    makeContext(workspaceRoot),
  );

  const manifestPath = join(workspaceRoot, "notausgang-export", "notausgang-manifest.yaml");
  await writeFile(manifestPath, "schemaVersion: 1.0.0\nsystemId: ''\n", "utf8");

  const result = await runNotausgangValidate(
    makeInput({ path: "notausgang-export" }),
    makeContext(workspaceRoot),
  );

  expect(result.exitCode).toBe(1);
  expect(expectData(result).manifest).toBe("invalid");
  expect(expectData(result).violations.some((v) => v.rule === "manifest-schema-invalid")).toBe(
    true,
  );
});

test("validate fails on Bordbuch line parse error", async () => {
  await runNotausgangExport(
    makeInput({
      system: "test-bundle",
      release: "test-bundle-r202607",
      output: "notausgang-export",
    }),
    makeContext(workspaceRoot),
  );

  const bordbuchPath = join(workspaceRoot, "notausgang-export", "bordbuch", "events.ndjson");
  const content = await readFile(bordbuchPath, "utf8");
  const lines = content.split("\n").filter((l) => l.trim());
  await writeFile(bordbuchPath, lines[0] + "\n{invalid json}\n", "utf8");

  const result = await runNotausgangValidate(
    makeInput({ path: "notausgang-export" }),
    makeContext(workspaceRoot),
  );

  expect(result.exitCode).toBe(1);
  expect(expectData(result).violations.some((v) => v.rule === "bordbuch-line-parse")).toBe(true);
});

test("validate fails on pin content mismatch (systemId)", async () => {
  await runNotausgangExport(
    makeInput({
      system: "test-bundle",
      release: "test-bundle-r202607",
      output: "notausgang-export",
    }),
    makeContext(workspaceRoot),
  );

  const pinPath = join(workspaceRoot, "notausgang-export", "system.pin.yaml");
  const pinData = parseYaml(await readFile(pinPath, "utf8"));
  pinData.systemId = "wrong-system";
  await writeFile(pinPath, stringifyYaml(pinData) + "\n", "utf8");

  const result = await runNotausgangValidate(
    makeInput({ path: "notausgang-export" }),
    makeContext(workspaceRoot),
  );

  expect(result.exitCode).toBe(1);
  expect(expectData(result).violations.some((v) => v.rule === "pin-content-mismatch")).toBe(true);
});

test("validate fails on legacy notausgang-manifest.json", async () => {
  await runNotausgangExport(
    makeInput({
      system: "test-bundle",
      release: "test-bundle-r202607",
      output: "notausgang-export",
    }),
    makeContext(workspaceRoot),
  );

  const manifestYamlPath = join(workspaceRoot, "notausgang-export", "notausgang-manifest.yaml");
  const manifestJsonPath = join(workspaceRoot, "notausgang-export", "notausgang-manifest.json");
  const yamlContent = await readFile(manifestYamlPath, "utf8");
  const parsed = parseYaml(yamlContent);
  await writeFile(manifestJsonPath, JSON.stringify(parsed, null, 2), "utf8");

  const result = await runNotausgangValidate(
    makeInput({ path: "notausgang-export" }),
    makeContext(workspaceRoot),
  );

  expect(result.exitCode).toBe(1);
  expect(expectData(result).violations.some((v) => v.rule === "legacy-json-artifact")).toBe(true);
});

test("validate fails on legacy system.pin.json", async () => {
  await runNotausgangExport(
    makeInput({
      system: "test-bundle",
      release: "test-bundle-r202607",
      output: "notausgang-export",
    }),
    makeContext(workspaceRoot),
  );

  const pinYamlPath = join(workspaceRoot, "notausgang-export", "system.pin.yaml");
  const pinJsonPath = join(workspaceRoot, "notausgang-export", "system.pin.json");
  const pinData = parseYaml(await readFile(pinYamlPath, "utf8"));
  await writeFile(pinJsonPath, JSON.stringify(pinData, null, 2), "utf8");

  const result = await runNotausgangValidate(
    makeInput({ path: "notausgang-export" }),
    makeContext(workspaceRoot),
  );

  expect(result.exitCode).toBe(1);
  expect(expectData(result).violations.some((v) => v.rule === "legacy-pin-format")).toBe(true);
});

test("validate fails on missing behavior-snapshots directory", async () => {
  await runNotausgangExport(
    makeInput({
      system: "test-bundle",
      release: "test-bundle-r202607",
      output: "notausgang-export",
    }),
    makeContext(workspaceRoot),
  );

  const snapshotsDir = join(workspaceRoot, "notausgang-export", "behavior-snapshots");
  await rm(snapshotsDir, { recursive: true, force: true });

  const result = await runNotausgangValidate(
    makeInput({ path: "notausgang-export" }),
    makeContext(workspaceRoot),
  );

  expect(result.exitCode).toBe(1);
  expect(expectData(result).snapshots).toBe("missing");
  expect(expectData(result).violations.some((v) => v.rule === "snapshots-missing")).toBe(true);
});

test("validate fails on secret detected outside safe locations", async () => {
  await runNotausgangExport(
    makeInput({
      system: "test-bundle",
      release: "test-bundle-r202607",
      output: "notausgang-export",
    }),
    makeContext(workspaceRoot),
  );

  await writeFile(
    join(workspaceRoot, "notausgang-export", "site", "src", "content", "secret.md"),
    "API_KEY=sk_live_abcdefghijklmnopqrstuvwxyz123456\n",
    "utf8",
  );

  const result = await runNotausgangValidate(
    makeInput({ path: "notausgang-export" }),
    makeContext(workspaceRoot),
  );

  expect(result.exitCode).toBe(1);
  expect(expectData(result).violations.some((v) => v.rule === "secret-detected")).toBe(true);
});

test("NotausgangValidateData uses CheckStatus enum values", async () => {
  await runNotausgangExport(
    makeInput({
      system: "test-bundle",
      release: "test-bundle-r202607",
      output: "notausgang-export",
    }),
    makeContext(workspaceRoot),
  );

  const result = await runNotausgangValidate(
    makeInput({ path: "notausgang-export" }),
    makeContext(workspaceRoot),
  );

  const validStatuses = ["valid", "invalid", "missing"];
  expect(validStatuses).toContain(expectData(result).manifest);
  expect(validStatuses).toContain(expectData(result).site);
  expect(validStatuses).toContain(expectData(result).dist);
  expect(validStatuses).toContain(expectData(result).bordbuch);
  expect(validStatuses).toContain(expectData(result).pin);
  expect(validStatuses).toContain(expectData(result).snapshots);
  expect(validStatuses).toContain(expectData(result).artifactManifest);
});

test("NotausgangViolation has no severity field", async () => {
  await runNotausgangExport(
    makeInput({
      system: "test-bundle",
      release: "test-bundle-r202607",
      output: "notausgang-export",
    }),
    makeContext(workspaceRoot),
  );

  const distFile = join(workspaceRoot, "notausgang-export", "dist", "index.html");
  await writeFile(distFile, "<html><body>tampered</body></html>\n", "utf8");

  const result = await runNotausgangValidate(
    makeInput({ path: "notausgang-export" }),
    makeContext(workspaceRoot),
  );

  expect(result.exitCode).toBe(1);
  for (const v of expectData(result).violations) {
    expect("severity" in v).toBe(false);
    expect(v.rule).toBeTruthy();
    expect(v.message).toBeTruthy();
  }
});
