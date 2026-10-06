/*
<MODULE_CONTRACT>
  <purpose>
RFC-1210: unit tests for remediation.signal.ingest — trust boundary (SIG-02),
routing (auto-mission / action-pack / suppressed-autonomy-off / deduped /
rate-capped), and dedup ledger behavior.
  </purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1210: initial tests — all ingest routes against a tmp workspace fixture with injected openMission.</item>
  <item>RFC-1210: closed-loop signal ingest to bounded missions (RFC-1210)</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runRemediationSignalIngest,
  type IngestDeps,
  type SignalIngestData,
} from "../remediation-signal-ingest.ts";
import { buildActualState } from "../../runtime/reconciler.ts";
import type {
  KernelCommandInput,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-shared/kernel";
import type { ModuleExport } from "@warpgogol/werkstatt-shared/kernel";
import { createDefaultIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";
import { stringify as stringifyYaml } from "yaml";

const SITE = "acme";

function makeContext(workspaceRoot: string): KernelRuntimeContext {
  const mod: ModuleExport = {
    name: "test-module",
    version: "1.0.0",
    declarations: [],
    commands: [],
    pipelines: [],
  };
  return {
    io: createDefaultIO().io,
    workspaceRoot,
    actualState: buildActualState([mod]),
    dryRun: false,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  } as unknown as KernelRuntimeContext;
}

function input(flags: Record<string, string>): KernelCommandInput {
  return { argv: [], flags };
}

async function seedWorkspace(
  opts: { autonomy?: "off" | "bounded"; signalSources?: string[] } = {},
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "rem-ingest-"));
  const workspaceRoot = join(root, "werkstatt");
  const cacheClone = join(root, "systems-cache", SITE);
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
      remediation: {
        autonomy: opts.autonomy ?? "bounded",
        signalSources: opts.signalSources ?? ["operator", "observability-bridge"],
      },
    }),
  );
  return workspaceRoot;
}

/** Injected mission.open — creates a real open mission manifest on disk. */
function fakeOpenMission(workspaceRoot: string): IngestDeps["openMission"] & {
  calls: string[];
} {
  const calls: string[] = [];
  const fn = async (
    _root: string,
    systemId: string,
    brief: string,
  ): Promise<{ exitCode: number; missionId?: string; summary?: string }> => {
    calls.push(brief);
    const missionId = `${systemId}-m000001`;
    const dir = join(workspaceRoot, "missions", missionId);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "mission.yaml"),
      stringifyYaml({
        schemaVersion: "1.0.0",
        missionId,
        systemId,
        state: "open",
        brief,
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
  fn.calls = calls;
  return fn;
}

test("ingest: undeclared source exits 1 with SIG-02 and opens no mission", async () => {
  const workspaceRoot = await seedWorkspace();
  try {
    const openMission = fakeOpenMission(workspaceRoot);
    const result = await runRemediationSignalIngest(
      input({ site: SITE, class: "typography", source: "rogue-bot" }),
      makeContext(workspaceRoot),
      { openMission },
    );
    expect(result.exitCode).toBe(1);
    const diags = (result.data as { diagnostics: { ruleId: string }[] }).diagnostics;
    expect(diags[0].ruleId).toBe("SIG-02");
    expect(openMission.calls).toHaveLength(0);
  } finally {
    await rm(join(workspaceRoot, ".."), { recursive: true });
  }
});

test("ingest: unknown class exits 1 with SIG-01", async () => {
  const workspaceRoot = await seedWorkspace();
  try {
    const result = await runRemediationSignalIngest(
      input({ site: SITE, class: "invented-class", source: "operator" }),
      makeContext(workspaceRoot),
      { openMission: fakeOpenMission(workspaceRoot) },
    );
    expect(result.exitCode).toBe(1);
    const diags = (result.data as { diagnostics: { ruleId: string }[] }).diagnostics;
    expect(diags[0].ruleId).toBe("SIG-01");
  } finally {
    await rm(join(workspaceRoot, ".."), { recursive: true });
  }
});

test("ingest: autonomy off suppresses every class (AC-5)", async () => {
  const workspaceRoot = await seedWorkspace({ autonomy: "off" });
  try {
    const openMission = fakeOpenMission(workspaceRoot);
    const result = await runRemediationSignalIngest(
      input({ site: SITE, class: "typography", source: "operator" }),
      makeContext(workspaceRoot),
      { openMission },
    );
    expect(result.exitCode).toBe(0);
    const data = result.data as SignalIngestData;
    expect(data.route).toBe("suppressed-autonomy-off");
    expect(openMission.calls).toHaveLength(0);
    // signal is still journaled — autonomy-off is visible, never silent
    const ledger = await readFile(
      join(workspaceRoot, "..", "systems-cache", SITE, "operations", "remediation-signals.jsonl"),
      "utf8",
    );
    expect(ledger).toContain("suppressed-autonomy-off");
  } finally {
    await rm(join(workspaceRoot, ".."), { recursive: true });
  }
});

test("ingest: non-autoFixable class routes to action-pack (AC-3)", async () => {
  const workspaceRoot = await seedWorkspace();
  try {
    const openMission = fakeOpenMission(workspaceRoot);
    const result = await runRemediationSignalIngest(
      input({ site: SITE, class: "content-regression", source: "operator" }),
      makeContext(workspaceRoot),
      { openMission },
    );
    expect(result.exitCode).toBe(0);
    expect((result.data as SignalIngestData).route).toBe("action-pack");
    expect(openMission.calls).toHaveLength(0);
  } finally {
    await rm(join(workspaceRoot, ".."), { recursive: true });
  }
});

test("ingest: autoFixable + bounded opens exactly one mission (AC-2, AC-8)", async () => {
  const workspaceRoot = await seedWorkspace();
  try {
    const openMission = fakeOpenMission(workspaceRoot);
    const result = await runRemediationSignalIngest(
      input({
        site: SITE,
        class: "typography",
        source: "observability-bridge",
        evidence: "probes/run-42",
      }),
      makeContext(workspaceRoot),
      { openMission },
    );
    expect(result.exitCode).toBe(0);
    const data = result.data as SignalIngestData;
    expect(data.route).toBe("auto-mission");
    expect(data.missionId).toBe(`${SITE}-m000001`);
    expect(openMission.calls).toHaveLength(1);
    expect(openMission.calls[0]).toContain("typography.fix");
    // signal evidence file inside the mission dir
    const evidence = JSON.parse(
      await readFile(
        join(workspaceRoot, "missions", `${SITE}-m000001`, "remediation-signal.json"),
        "utf8",
      ),
    );
    expect(evidence.evidenceRefs).toEqual(["probes/run-42"]);
  } finally {
    await rm(join(workspaceRoot, ".."), { recursive: true });
  }
});

test("ingest: second signal for open (site,class) dedups (AC-4)", async () => {
  const workspaceRoot = await seedWorkspace();
  try {
    const openMission = fakeOpenMission(workspaceRoot);
    const ctx = makeContext(workspaceRoot);
    const first = await runRemediationSignalIngest(
      input({ site: SITE, class: "typography", source: "operator" }),
      ctx,
      { openMission },
    );
    expect((first.data as SignalIngestData).route).toBe("auto-mission");
    const second = await runRemediationSignalIngest(
      input({ site: SITE, class: "typography", source: "operator" }),
      ctx,
      { openMission },
    );
    expect((second.data as SignalIngestData).route).toBe("deduped");
    expect(openMission.calls).toHaveLength(1);
  } finally {
    await rm(join(workspaceRoot, ".."), { recursive: true });
  }
});

test("ingest: closed prior mission does not dedup a new signal", async () => {
  const workspaceRoot = await seedWorkspace();
  try {
    const openMission = fakeOpenMission(workspaceRoot);
    const ctx = makeContext(workspaceRoot);
    await runRemediationSignalIngest(
      input({ site: SITE, class: "typography", source: "operator" }),
      ctx,
      { openMission },
    );
    // close the fake mission
    const manifestPath = join(
      workspaceRoot,
      "missions",
      `${SITE}-m000001`,
      "mission.yaml",
    );
    const { parse: parseYaml } = await import("yaml");
    const manifest = parseYaml(await readFile(manifestPath, "utf8"));
    manifest.state = "closed";
    manifest.closedAt = new Date().toISOString();
    await writeFile(manifestPath, stringifyYaml(manifest));

    const second = await runRemediationSignalIngest(
      input({ site: SITE, class: "typography", source: "operator" }),
      ctx,
      { openMission },
    );
    // rate cap for typography is 2/day — second auto-mission is allowed
    expect((second.data as SignalIngestData).route).toBe("auto-mission");
    expect(openMission.calls).toHaveLength(2);
  } finally {
    await rm(join(workspaceRoot, ".."), { recursive: true });
  }
});

test("ingest: rate cap degrades to rate-capped, never silently drops", async () => {
  const workspaceRoot = await seedWorkspace();
  try {
    const openMission = fakeOpenMission(workspaceRoot);
    const ctx = makeContext(workspaceRoot);
    // generated-drift cap = 1/day
    await runRemediationSignalIngest(
      input({ site: SITE, class: "generated-drift", source: "operator" }),
      ctx,
      { openMission },
    );
    // close the mission so dedup doesn't fire first
    const manifestPath = join(
      workspaceRoot,
      "missions",
      `${SITE}-m000001`,
      "mission.yaml",
    );
    const { parse: parseYaml } = await import("yaml");
    const manifest = parseYaml(await readFile(manifestPath, "utf8"));
    manifest.state = "closed";
    await writeFile(manifestPath, stringifyYaml(manifest));

    const capped = await runRemediationSignalIngest(
      input({ site: SITE, class: "generated-drift", source: "operator" }),
      ctx,
      { openMission },
    );
    expect(capped.exitCode).toBe(0);
    expect((capped.data as SignalIngestData).route).toBe("rate-capped");
    const ledger = await readFile(
      join(workspaceRoot, "..", "systems-cache", SITE, "operations", "remediation-signals.jsonl"),
      "utf8",
    );
    expect(ledger).toContain("rate-capped");
  } finally {
    await rm(join(workspaceRoot, ".."), { recursive: true });
  }
});
