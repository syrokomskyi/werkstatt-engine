/*
<MODULE_CONTRACT>
  <purpose>
RFC-1210: AC-6 evidence — an auto-mission open appends a `remediation-mission`
bordbuch bookkeeping entry carrying the triggering signal's evidenceRefs.
  </purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1210: initial test — bordbuch entry shape + BOOKKEEPING_BORDBUCH_KINDS membership.</item>
  <item>RFC-1210: closed-loop signal ingest to bounded missions (RFC-1210)</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { runRemediationSignalIngest } from "../remediation-signal-ingest.ts";
import { readBordbuch } from "../../bordbuch/bordbuch-io.ts";
import { BOOKKEEPING_BORDBUCH_KINDS } from "../../sternsystem/passport-staleness.ts";
import { buildActualState } from "../../runtime/reconciler.ts";
import type {
  KernelCommandInput,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-shared/kernel";
import { createDefaultIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";

const SITE = "acme";

test("auto-mission appends remediation-mission bordbuch entry with signal evidence (AC-6)", async () => {
  const root = await mkdtemp(join(tmpdir(), "rem-mission-open-"));
  const workspaceRoot = join(root, "werkstatt");
  const cacheClone = join(root, "systems-cache", SITE);
  try {
    await mkdir(join(workspaceRoot, "missions"), { recursive: true });
    await mkdir(cacheClone, { recursive: true });
    await writeFile(
      join(cacheClone, "system-state.yaml"),
      stringifyYaml({
        schemaVersion: "1.0.0",
        systemId: SITE,
        currentMission: null,
        lastRelease: null,
        lastPropagated: {},
        accessPin: null,
        passportRequired: false,
        ownershipRequired: false,
        remediation: { autonomy: "bounded", signalSources: ["operator"] },
      }),
    );

    const context = {
      io: createDefaultIO().io,
      workspaceRoot,
      actualState: buildActualState([
        { name: "test", version: "1.0.0", declarations: [], commands: [], pipelines: [] },
      ]),
      dryRun: false,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    } as unknown as KernelRuntimeContext;

    const openMission = async (
      _root: string,
      systemId: string,
      _brief: string,
    ) => {
      const missionId = `${systemId}-m000001`;
      await mkdir(join(workspaceRoot, "missions", missionId), { recursive: true });
      await writeFile(
        join(workspaceRoot, "missions", missionId, "mission.yaml"),
        stringifyYaml({
          schemaVersion: "1.0.0",
          missionId,
          systemId,
          state: "open",
          brief: "x",
          openedAt: new Date().toISOString(),
          openedBy: "remediation:test",
          closedAt: null,
          closedBy: null,
          pinAtOpen: "6.0.0",
          materializedAt: null,
          reconciledAt: null,
          migratedAt: null,
          releaseId: null,
          rfcId: null,
          operationId: "op-test",
        }),
      );
      return { exitCode: 0, missionId };
    };

    const input: KernelCommandInput = {
      argv: [],
      flags: {
        site: SITE,
        class: "workpiece-deps",
        source: "operator",
        evidence: '["evidence/run-7.json","dist report"]',
      },
    };
    const result = await runRemediationSignalIngest(input, context, { openMission });
    expect(result.exitCode).toBe(0);

    const entries = await readBordbuch(workspaceRoot, SITE);
    const rem = entries.filter((e) => e.kind === "remediation-mission");
    expect(rem).toHaveLength(1);
    const meta = rem[0].metadata as Record<string, unknown>;
    expect(meta.signalClass).toBe("workpiece-deps");
    expect(meta.evidenceRefs).toEqual(["evidence/run-7.json", "dist report"]);
    expect(meta.fixCommand).toBe("config.regenerate");
    expect(rem[0].missionId).toBe(`${SITE}-m000001`);
    expect(BOOKKEEPING_BORDBUCH_KINDS.has("remediation-mission")).toBe(true);
  } finally {
    await rm(root, { recursive: true });
  }
});
