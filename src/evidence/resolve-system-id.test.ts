/*
<MODULE_CONTRACT>
  <purpose>RFC-1324 regression tests for resolveSystemIdForMission — the resolver shared by evidence.sync and evidence.fetch.</purpose>
  <non-goals>
    <item>Does not exercise R2 upload/download — covered by evidence-sync-fetch.test.ts.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1324: initial — locks in the manifest-first order and the `-mNNNNNN`-only suffix strip after `e2e-valid-minimal-m000001` resolved to `e2e-valid`.</item>
  <item>RFC-1324: cold-run defect: evidence.sync/fetch resolveSystemId split on bare '-m' — e2e-valid-minimal-m000001 resolved to e2e-valid, SYSTEM_MISMATCH blocked post-close deploy; shared resolveSystemIdForMission reads mission.yaml first</item>
</CHANGE_SUMMARY>
*/

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { createDefaultIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";
import { resolveSystemIdForMission } from "./resolve-system-id.ts";

const MANIFEST = {
  schemaVersion: "1.0.0",
  missionId: "e2e-valid-minimal-m000001",
  systemId: "e2e-valid-minimal",
  state: "closed",
  brief: "e2e",
  openedAt: "2026-10-18T20:00:00.000Z",
  openedBy: "e2e",
  closedAt: "2026-10-18T20:30:00.000Z",
  closedBy: null,
  pinAtOpen: "x",
  materializedAt: null,
  reconciledAt: null,
  migratedAt: null,
  releaseId: null,
  rfcId: null,
  operationId: "op-x",
};

describe("resolveSystemIdForMission (RFC-1324)", () => {
  let root: string;
  let workspaceRoot: string;
  const io = createDefaultIO().io;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "resolve-system-id-"));
    workspaceRoot = join(root, "werkstatt");
    await mkdir(join(workspaceRoot, "missions"), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("reads systemId from mission.yaml — the mid-slug '-m' case that split('-m') broke", async () => {
    const dir = join(workspaceRoot, "missions", MANIFEST.missionId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "mission.yaml"), stringifyYaml(MANIFEST));
    expect(await resolveSystemIdForMission(workspaceRoot, MANIFEST.missionId, io)).toBe(
      "e2e-valid-minimal",
    );
  });

  it("falls back to the currentMission scan when no manifest exists", async () => {
    const cache = join(root, "systems-cache", "my-site");
    await mkdir(cache, { recursive: true });
    await writeFile(
      join(cache, "system-config.yaml"),
      stringifyYaml({
        schemaVersion: "1.0.0",
        id: "my-site",
        cosmicStar: "Polaris",
        mirrors: [{ path: cache, storageType: "non-bare" }],
      }),
    );
    await writeFile(
      join(cache, "system-state.yaml"),
      stringifyYaml({
        schemaVersion: "1.0.0",
        systemId: "my-site",
        currentMission: "my-site-m000007",
      }),
    );
    expect(await resolveSystemIdForMission(workspaceRoot, "my-site-m000007", io)).toBe("my-site");
  });

  it("strips only the canonical -mNNNNNN suffix as a last resort", async () => {
    expect(await resolveSystemIdForMission(workspaceRoot, "site-minimal-m000042", io)).toBe(
      "site-minimal",
    );
    expect(await resolveSystemIdForMission(workspaceRoot, "plainid-m000001", io)).toBe("plainid");
  });

  it("returns the whole id when nothing matches and no suffix exists", async () => {
    expect(await resolveSystemIdForMission(workspaceRoot, "custom-mission", io)).toBe(
      "custom-mission",
    );
  });
});
