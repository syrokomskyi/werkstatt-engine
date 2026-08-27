/*
<MODULE_CONTRACT>
  <purpose>
    RFC-0651: optional integration test for evidence.sync and evidence.fetch against a real R2 bucket.
    Skips automatically when R2_AXIOM_ACCOUNT_ID is not set in the environment.
  </purpose>
  <keywords>RFC-0651, evidence, integration, r2</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0651: initial integration test — skips when R2 credentials are absent.</item>
  <item>RFC-0651: fix integration test type errors</item>
</CHANGE_SUMMARY>
*/

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  KernelCommandInput,
  KernelRuntimeContext,
  KernelFlagValue,
} from "@warpgogol/werkstatt-engine/kernel";
import { createDefaultIO, createKernelLogger } from "@warpgogol/werkstatt-engine/kernel";
import type {
  EvidenceSyncResult,
  EvidenceFetchResult,
  EvidenceListResult,
} from "../evidence/index.ts";
import { runEvidenceSync } from "../evidence/evidence-sync.ts";
import { runEvidenceFetch } from "../evidence/evidence-fetch.ts";

const RUN_TIMESTAMP = "2026-08-02T00-00-00-000Z";
const MISSION_ID = "warpgogol-com-integration-test";
const _SYSTEM_ID = "warpgogol-com";

function makeInput(flags: Record<string, KernelFlagValue>): KernelCommandInput {
  return { argv: [], flags };
}

function makeContext(workspaceRoot: string): KernelRuntimeContext {
  const { io } = createDefaultIO();
  return {
    workspaceRoot,
    io,
    logger: createKernelLogger("json"),
    dryRun: false,
    siteExplicit: false,
    outputFormat: "json",
    registry: undefined as never,
  };
}

async function createTestEvidence(workspaceRoot: string): Promise<void> {
  const evidenceDir = join(workspaceRoot, "missions", MISSION_ID, "evidence", "axiom");
  await mkdir(evidenceDir, { recursive: true });
  await mkdir(join(evidenceDir, "raw"), { recursive: true });

  await writeFile(
    join(evidenceDir, "evidence-metadata.json"),
    JSON.stringify({
      auditId: MISSION_ID,
      runTimestamp: RUN_TIMESTAMP,
      commitSha: "integration-test-sha",
    }),
  );
  await writeFile(join(evidenceDir, "study-run.json"), '{"findings": [], "errors": 0}');
  await writeFile(join(evidenceDir, "observation-bundle.json"), '{"observations": []}');
  await writeFile(join(evidenceDir, "staged-capsule.json"), '{"capsule": "test"}');
  await writeFile(
    join(evidenceDir, "report.html"),
    "<html><body>Integration test report</body></html>",
  );
  await writeFile(join(evidenceDir, "raw", "page-1.json"), '{"page": 1, "axe": "raw"}');
}

describe.skipIf(!process.env.R2_AXIOM_ACCOUNT_ID)(
  "evidence integration (RFC-0651, real R2)",
  () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), "evidence-integration-"));
    });

    afterEach(async () => {
      await rm(tmpDir, { recursive: true, force: true });
    });

    it("evidence.sync uploads to R2, evidence.fetch downloads back", async () => {
      await createTestEvidence(tmpDir);

      const syncResult = await runEvidenceSync(
        makeInput({ mission: MISSION_ID, "run-timestamp": RUN_TIMESTAMP }),
        makeContext(tmpDir),
      );

      expect(syncResult.exitCode).toBe(0);
      const syncData = syncResult.data as EvidenceSyncResult | undefined;
      expect(syncData?.uploadedFiles).toContain("evidence-metadata.json");
      expect(syncData?.uploadedFiles).toContain("raw/page-1.json");

      const fetchDir = join(tmpDir, "fetched");
      const fetchResult = await runEvidenceFetch(
        makeInput({
          mission: MISSION_ID,
          "run-timestamp": RUN_TIMESTAMP,
          "output-dir": fetchDir,
        }),
        makeContext(tmpDir),
      );

      expect(fetchResult.exitCode).toBe(0);
      const fetchData = fetchResult.data as EvidenceFetchResult | undefined;
      expect(fetchData?.downloadedFiles).toContain("evidence-metadata.json");
      expect(fetchData?.downloadedFiles).toContain("raw/page-1.json");

      const originalMeta = JSON.parse(
        await readFile(
          join(tmpDir, "missions", MISSION_ID, "evidence", "axiom", "evidence-metadata.json"),
          "utf8",
        ),
      );
      const fetchedMeta = JSON.parse(
        await readFile(join(fetchDir, "evidence-metadata.json"), "utf8"),
      );
      expect(fetchedMeta).toEqual(originalMeta);
    });

    it("evidence.fetch --list returns the synced run", async () => {
      const listResult = await runEvidenceFetch(
        makeInput({ mission: MISSION_ID, list: true }),
        makeContext(tmpDir),
      );

      expect(listResult.exitCode).toBe(0);
      const listData = listResult.data as EvidenceListResult | undefined;
      const runs = listData?.runs ?? [];
      const matchingRun = runs.find(
        (r: { runTimestamp: string }) => r.runTimestamp === RUN_TIMESTAMP,
      );
      expect(matchingRun).toBeDefined();
      expect(matchingRun?.commitSha).toBe("integration-test-sha");
    });
  },
);
