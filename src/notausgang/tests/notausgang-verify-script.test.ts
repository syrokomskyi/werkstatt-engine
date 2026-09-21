/*
<MODULE_CONTRACT>
<purpose>RFC-1120 AC-7: end-to-end test for the bundled offline verifier — runs the exported verify.py via python3 against a real export package, asserting exit 0 on a valid package and non-zero after tampering.</purpose>
<non-goals>
  <item>Do not test notausgang.validate rules — covered by tests-handoff/notausgang.test.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1120: initial verify.py acceptance test.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { stringify as stringifyYaml } from "yaml";
import { runNotausgangExport } from "../notausgang-commands.ts";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";

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

const SYSTEM_ID = "test-bundle";
const RELEASE_ID = "test-bundle-r202607";

beforeEach(async () => {
  testRoot = await mkdtemp(join(tmpdir(), "na-verify-"));
  workspaceRoot = join(testRoot, "workspace");
  await mkdir(workspaceRoot, { recursive: true });

  // Release fixture: manifest + dist + artifact manifest + snapshots
  const releaseDir = join(workspaceRoot, "releases", RELEASE_ID);
  await mkdir(join(releaseDir, "dist"), { recursive: true });
  await writeFile(
    join(releaseDir, "release.yaml"),
    stringifyYaml({
      state: "ready",
      platformVersion: "4.5.0",
      platformSemanticHash: "sha256:abc123",
      semver: "4.5.0",
      distArtifactHash: "sha256:dist-abc",
      siteContentHash: "sha256:site-abc",
      behaviorSnapshotHash: "sha256:snap-abc",
    }) + "\n",
    "utf8",
  );
  await writeFile(join(releaseDir, "dist", "index.html"), "<html><body>test</body></html>\n");
  await writeFile(
    join(releaseDir, "artifact-manifest.json"),
    JSON.stringify({ artifacts: [{ name: "dist", hash: "sha256:abc" }] }),
    "utf8",
  );
  for (const s of ["readable-snapshot.json", "production-snapshot.json", "snapshot-diff.json"]) {
    await writeFile(join(releaseDir, s), '{"version":"1.0"}\n', "utf8");
  }

  // Cache clone fixture: system-config + bordbuch + pin
  const cacheDir = join(testRoot, "systems-cache", SYSTEM_ID);
  await mkdir(join(cacheDir, "bordbuch"), { recursive: true });
  await writeFile(
    join(cacheDir, "system-config.yaml"),
    stringifyYaml({
      schemaVersion: "system-config/v1",
      id: SYSTEM_ID,
      cosmicStar: "Vega",
      status: "active",
      mirrors: [{ path: "../systems-cache/test-bundle", storageType: "non-bare" }],
      pinnedPlatform: "4.5.0",
      registeredAt: "2026-07-12T10:00:00.000Z",
      notes: "",
    }) + "\n",
    "utf8",
  );
  await writeFile(
    join(cacheDir, "bordbuch", "events.ndjson"),
    JSON.stringify({
      schemaVersion: "1.0.0",
      id: "event-000001",
      systemId: SYSTEM_ID,
      occurredAt: "2026-07-12T10:00:00.000Z",
      kind: "release",
      status: "done",
      missionId: null,
      releaseId: null,
      actor: "agent",
      summary: "release event",
      metadata: {},
      previousHash: null,
      hash: "sha256:aaa",
    }) + "\n",
    "utf8",
  );
  await writeFile(
    join(cacheDir, "system.pin.json"),
    JSON.stringify({
      schemaVersion: "1.0.0",
      systemId: SYSTEM_ID,
      cosmicStar: "Vega",
      pinnedAt: "2026-07-12T10:00:00.000Z",
      platform: { version: "4.5.0", commit: "0000000", rfcHead: "RFC-0000", platformSemanticHash: "sha256:abc" },
      migratorCursor: "4.5.0",
      capabilities: [],
    }),
    "utf8",
  );

  // Site workspace fixture (apps/<id> — resolver target when no mission/cache package.json)
  const appDir = join(workspaceRoot, "apps", SYSTEM_ID);
  await mkdir(join(appDir, "src", "content"), { recursive: true });
  await writeFile(join(appDir, "package.json"), JSON.stringify({ name: SYSTEM_ID, version: "1.0.0" }), "utf8");
  await writeFile(join(appDir, "src", "content", "test.md"), "# Test\n", "utf8");

  await mkdir(join(workspaceRoot, "docs", "rfcs"), { recursive: true });
  await writeFile(join(workspaceRoot, "package.json"), JSON.stringify({ version: "4.5.0" }), "utf8");
});

afterEach(async () => {
  await rm(testRoot, { recursive: true, force: true });
});

test("verify.py exits 0 on valid package and non-zero on tampered evidence", async () => {
  await runNotausgangExport(
    makeInput({ system: SYSTEM_ID, release: RELEASE_ID, output: "notausgang-export" }),
    makeContext(workspaceRoot),
  );

  const outputDir = join(workspaceRoot, "notausgang-export");
  const verifyScript = join(outputDir, "verify.py");

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
