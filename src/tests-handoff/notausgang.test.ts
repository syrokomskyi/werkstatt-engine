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
  // RFC-1120: JSON twin is now a required package file (stdlib verifier input)
  expect(existsSync(join(outputDir, "notausgang-manifest.json"))).toBe(true);
  expect(existsSync(join(outputDir, "system.pin.yaml"))).toBe(true);
  expect(existsSync(join(outputDir, "system.pin.json"))).toBe(false);
  expect(existsSync(join(outputDir, "artifact-manifest.yaml"))).toBe(true);
  expect(existsSync(join(outputDir, "artifact-manifest.json"))).toBe(false);
});

test("export emits RFC-1120 package additions", async () => {
  const outputDir = join(workspaceRoot, "notausgang-export");

  const result = await runNotausgangExport(
    makeInput({
      system: "test-bundle",
      release: "test-bundle-r202607",
      output: "notausgang-export",
    }),
    makeContext(workspaceRoot),
  );

  const data = expectData(result);
  expect(existsSync(join(outputDir, "verify.py"))).toBe(true);
  expect(existsSync(join(outputDir, "verification.md"))).toBe(true);
  expect(existsSync(join(outputDir, "SHA256SUMS.txt"))).toBe(true);
  expect(existsSync(join(outputDir, "feature-notes.md"))).toBe(true);
  expect(existsSync(join(outputDir, "evidence"))).toBe(true);
  expect(data.verifier).toEqual({
    script: "verify.py",
    runtime: "python3-stdlib",
    manifestFile: "notausgang-manifest.json",
  });
  expect(data.evidence).toEqual({});
  expect(Array.isArray(data.features)).toBe(true);

  // SHA256SUMS.txt covers every package file except itself
  const sums = await readFile(join(outputDir, "SHA256SUMS.txt"), "utf8");
  expect(sums).toMatch(/^[a-f0-9]{64}  [^\n]+$/m);
  expect(sums).toContain("  notausgang-manifest.json");
  expect(sums).toContain("  verify.py");
  expect(sums).not.toContain("  SHA256SUMS.txt");

  // JSON twin carries the same evidence/features/verifier as the YAML manifest
  const yamlManifest = parseYaml(
    await readFile(join(outputDir, "notausgang-manifest.yaml"), "utf8"),
  );
  const jsonManifest = JSON.parse(
    await readFile(join(outputDir, "notausgang-manifest.json"), "utf8"),
  );
  expect(jsonManifest.evidence).toEqual(yamlManifest.evidence);
  expect(jsonManifest.features).toEqual(yamlManifest.features);
  expect(jsonManifest.verifier).toEqual(yamlManifest.verifier);
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

test("validate fails when the JSON manifest twin diverges (NA-MANIFEST-02)", async () => {
  await runNotausgangExport(
    makeInput({
      system: "test-bundle",
      release: "test-bundle-r202607",
      output: "notausgang-export",
    }),
    makeContext(workspaceRoot),
  );

  const manifestJsonPath = join(workspaceRoot, "notausgang-export", "notausgang-manifest.json");
  const parsed = JSON.parse(await readFile(manifestJsonPath, "utf8"));
  parsed.evidence = { tampered: { verdict: "bundled" } };
  await writeFile(manifestJsonPath, JSON.stringify(parsed, null, 2), "utf8");

  const result = await runNotausgangValidate(
    makeInput({ path: "notausgang-export" }),
    makeContext(workspaceRoot),
  );

  expect(result.exitCode).toBe(1);
  expect(expectData(result).violations.some((v) => v.rule === "NA-MANIFEST-02")).toBe(true);
});

test("validate fails when the JSON manifest twin is missing (NA-MANIFEST-02)", async () => {
  await runNotausgangExport(
    makeInput({
      system: "test-bundle",
      release: "test-bundle-r202607",
      output: "notausgang-export",
    }),
    makeContext(workspaceRoot),
  );

  await rm(join(workspaceRoot, "notausgang-export", "notausgang-manifest.json"));

  const result = await runNotausgangValidate(
    makeInput({ path: "notausgang-export" }),
    makeContext(workspaceRoot),
  );

  expect(result.exitCode).toBe(1);
  expect(expectData(result).violations.some((v) => v.rule === "NA-MANIFEST-02")).toBe(true);
});

test("validate fails when a bundled evidence dir lacks integrity.txt (NA-EVIDENCE-01)", async () => {
  await runNotausgangExport(
    makeInput({
      system: "test-bundle",
      release: "test-bundle-r202607",
      output: "notausgang-export",
    }),
    makeContext(workspaceRoot),
  );

  // Craft a manifest that records a bundled source without the matching directory
  const manifestPath = join(workspaceRoot, "notausgang-export", "notausgang-manifest.yaml");
  const manifest = parseYaml(await readFile(manifestPath, "utf8"));
  manifest.evidence = { "ghost-source": { verdict: "bundled" } };
  await writeFile(manifestPath, stringifyYaml(manifest) + "\n", "utf8");

  const result = await runNotausgangValidate(
    makeInput({ path: "notausgang-export" }),
    makeContext(workspaceRoot),
  );

  expect(result.exitCode).toBe(1);
  expect(expectData(result).violations.some((v) => v.rule === "NA-EVIDENCE-01")).toBe(true);
});

test("validate fails on evidence artifact hash mismatch (NA-EVIDENCE-02)", async () => {
  await runNotausgangExport(
    makeInput({
      system: "test-bundle",
      release: "test-bundle-r202607",
      output: "notausgang-export",
    }),
    makeContext(workspaceRoot),
  );

  const evidenceDir = join(workspaceRoot, "notausgang-export", "evidence", "src-x");
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(join(evidenceDir, "doc.pdf"), "tampered-bytes\n", "utf8");
  await writeFile(join(evidenceDir, "integrity.txt"), `${"0".repeat(64)}  doc.pdf\n`, "utf8");

  const result = await runNotausgangValidate(
    makeInput({ path: "notausgang-export" }),
    makeContext(workspaceRoot),
  );

  expect(result.exitCode).toBe(1);
  expect(expectData(result).violations.some((v) => v.rule === "NA-EVIDENCE-02")).toBe(true);
});

test("validate fails when feature-notes.md is missing (NA-FEATURES-01)", async () => {
  await runNotausgangExport(
    makeInput({
      system: "test-bundle",
      release: "test-bundle-r202607",
      output: "notausgang-export",
    }),
    makeContext(workspaceRoot),
  );

  await rm(join(workspaceRoot, "notausgang-export", "feature-notes.md"));

  const result = await runNotausgangValidate(
    makeInput({ path: "notausgang-export" }),
    makeContext(workspaceRoot),
  );

  expect(result.exitCode).toBe(1);
  expect(expectData(result).violations.some((v) => v.rule === "NA-FEATURES-01")).toBe(true);
});

test("validate fails when verifier files are missing (NA-VERIFIER-01)", async () => {
  await runNotausgangExport(
    makeInput({
      system: "test-bundle",
      release: "test-bundle-r202607",
      output: "notausgang-export",
    }),
    makeContext(workspaceRoot),
  );

  await rm(join(workspaceRoot, "notausgang-export", "verify.py"));

  const result = await runNotausgangValidate(
    makeInput({ path: "notausgang-export" }),
    makeContext(workspaceRoot),
  );

  expect(result.exitCode).toBe(1);
  expect(expectData(result).violations.some((v) => v.rule === "NA-VERIFIER-01")).toBe(true);
});

test("bundled verify.py exits 0 on a valid package and non-zero on tampering", async () => {
  await runNotausgangExport(
    makeInput({
      system: "test-bundle",
      release: "test-bundle-r202607",
      output: "notausgang-export",
    }),
    makeContext(workspaceRoot),
  );

  const outputDir = join(workspaceRoot, "notausgang-export");
  const verifyScript = join(outputDir, "verify.py");
  const { execFileSync } = await import("node:child_process");

  // Valid package → exit 0
  const okOut = execFileSync("python3", [verifyScript, outputDir], { encoding: "utf8" });
  expect(okOut).toContain("OK");

  // Tamper a file covered by SHA256SUMS.txt → non-zero exit
  await writeFile(join(outputDir, "dist", "index.html"), "tampered\n", "utf8");
  let failed = false;
  try {
    execFileSync("python3", [verifyScript, outputDir], { encoding: "utf8", stdio: "pipe" });
  } catch (err) {
    failed = true;
    expect((err as { status: number }).status).toBe(1);
  }
  expect(failed).toBe(true);
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
    "API_KEY=TESTSECRET_abcdefghijklmnopqrst123456\n",
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
