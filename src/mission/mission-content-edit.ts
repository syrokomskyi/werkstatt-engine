/*
<MODULE_CONTRACT>
<purpose>
  RFC-1263: mission.content-edit — the content fast-lane composite. For a
  mission whose touched set resolves entirely inside the editable content
  surface it runs the scoped gate set (content.patch pipeline + author
  validators, content.regression.check, advisory deploy-preflight), commits
  via mission.git.commit, records the green gate set on the mission
  manifest, reconciles, and — once the site's contentEditLane is "active" —
  closes. leitstand.ship's full-validate gate is untouched: ship remains
  the only deploy path.
</purpose>
<non-goals>
  <item>Do not write evidence/validation-report.json — the fast-lane record
  lives in the mission manifest's fastLane field; scoped coverage must
  never read as full coverage downstream.</item>
  <item>Do not implement gate logic — the composite delegates every step to
  the underlying commands via executeKernelCommand.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1263: initial composite — eligibility -> content.patch -> CREG ->
  advisory deploy-preflight -> git.commit -> fastLane record -> reconcile ->
  close when contentEditLane=active (advisory rollout stops before close).</item>
  <item>RFC-1263</item>
</CHANGE_SUMMARY>
*/

import path from "node:path";
import { parse as parseYaml } from "yaml";

import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { executeKernelCommand } from "@warpgogol/werkstatt-engine/kernel";

import { readMissionManifest, writeMissionManifest, resolveMissionDir } from "./mission-io.ts";
import {
  evaluateContentEditEligibility,
  type ContentEditOpRef,
  type EligibilityResult,
} from "./content-edit-eligibility.ts";
import { readSystemState, resolveCacheClonePath } from "../sternsystem/registry-io.ts";
import { resolveActor } from "./actor-identity.ts";

export interface ContentEditGate {
  gate: string;
  status: "pass" | "fail" | "advisory";
  violations?: number;
}

export interface ContentEditResult {
  command: "mission.content-edit";
  status: "closed" | "fast-lane-ready" | "gate-failed" | "rejected" | "dry-run";
  mission: string | null;
  /** "fast" on admitted runs; "full" on rejection (AC-2). */
  lane: "fast" | "full";
  eligibility: EligibilityResult;
  gates: ContentEditGate[];
  commit?: string;
  reconciled?: boolean;
  closed?: boolean;
  durationMs: number;
}

interface StepResult {
  exitCode: number;
  data?: Record<string, unknown>;
  summary?: string;
}

async function step(
  workspaceRoot: string,
  commandName: string,
  argv: string[],
): Promise<StepResult> {
  const result = (await executeKernelCommand({
    workspaceRoot,
    commandName,
    argv,
    outputFormat: "json",
  })) as StepResult;
  return { exitCode: result.exitCode ?? 0, data: result.data, summary: result.summary };
}

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

function flagBoolean(input: KernelCommandInput, key: string): boolean {
  const v = input.flags[key];
  return v === true || v === "true";
}

// ─── touched-set resolution ──────────────────────────────────────────────────

/** Split `<collection>/<file>[#<fieldPath>]` — mirrors content-ops parseSelector. */
function splitSelector(
  raw: string,
): { collection: string; file: string; fieldPath: string } | null {
  const hash = raw.indexOf("#");
  const address = hash === -1 ? raw : raw.slice(0, hash);
  const fieldPath = hash === -1 ? "" : raw.slice(hash + 1);
  const slash = address.indexOf("/");
  if (slash === -1) {
    return address === "system" ? { collection: "system", file: "system", fieldPath } : null;
  }
  const collection = address.slice(0, slash);
  const file = address.slice(slash + 1);
  if (!collection || !file) return null;
  return { collection, file, fieldPath };
}

/** Parses the ops file (list or {ops:[…]}) into selector refs for eligibility. */
async function opsRefsFromFile(
  opsFile: string,
  io: KernelRuntimeContext["io"],
): Promise<{ ops: ContentEditOpRef[]; error?: string }> {
  if (!(await io.exists(opsFile))) return { ops: [], error: `--ops-file not found: ${opsFile}` };
  const parsed = parseYaml(await io.readFile(opsFile)) as
    Array<Record<string, unknown>> | { ops?: Array<Record<string, unknown>> } | null;
  const entries = Array.isArray(parsed) ? parsed : parsed?.ops;
  if (!Array.isArray(entries) || entries.length === 0) {
    return { ops: [], error: `${opsFile}: expected a non-empty ops list ([{op, selector, ...}])` };
  }
  const ops: ContentEditOpRef[] = [];
  for (const [i, raw] of entries.entries()) {
    const kind = (raw.kind ?? raw.op) as string | undefined;
    const selector = typeof raw.selector === "string" ? raw.selector : undefined;
    if (!kind || !selector) {
      return { ops: [], error: `ops[${i}]: needs selector + kind` };
    }
    const parts = splitSelector(selector);
    if (!parts) {
      return { ops: [], error: `ops[${i}]: malformed selector "${selector}"` };
    }
    ops.push({
      kind,
      ...parts,
      ...(typeof raw.fieldClass === "string" ? { fieldClass: raw.fieldClass } : {}),
    });
  }
  return { ops };
}

/** Workpiece `git status --porcelain` → changed workpiece-relative paths. */
async function workpieceTouchedFiles(
  workpieceDir: string,
  io: KernelRuntimeContext["io"],
): Promise<string[]> {
  const res = await io.exec("git", ["status", "--porcelain=v1", "-z"], { cwd: workpieceDir });
  if (res.exitCode !== 0) return [];
  return res.stdout
    .split("\0")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const p = line.slice(3);
      const arrow = p.indexOf(" -> ");
      return (arrow === -1 ? p : p.slice(arrow + 4)).replace(/^"|"$/g, "");
    });
}

// ─── composite ───────────────────────────────────────────────────────────────

export async function runMissionContentEdit(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<ContentEditResult>> {
  const { workspaceRoot, logger, io } = context;
  const startedAt = Date.now();

  const siteFlag = flagString(input, "site");
  const missionFlag = flagString(input, "mission");
  const brief = flagString(input, "brief");
  const opsFile = flagString(input, "ops-file");
  const message = flagString(input, "message");
  const actor = resolveActor(input);
  const dryRun = flagBoolean(input, "dry-run") || context.dryRun === true;

  const result = (
    partial: Omit<ContentEditResult, "command" | "durationMs">,
    exitCode: number,
    summary: string,
  ): KernelCommandResult<ContentEditResult> => ({
    data: { command: "mission.content-edit", durationMs: Date.now() - startedAt, ...partial },
    exitCode,
    summary,
  });

  if (Boolean(missionFlag) === Boolean(siteFlag)) {
    return result(
      {
        status: "rejected",
        mission: missionFlag ?? null,
        lane: "full",
        eligibility: { eligible: false, reasons: [] },
        gates: [],
      },
      1,
      "[mission.content-edit] exactly one of --mission or --site is required",
    );
  }

  // ── resolve mission / site surface ─────────────────────────────────────────
  let missionId = missionFlag ?? null;
  let systemId = siteFlag ?? "";
  let siteDir: string;

  if (missionId) {
    const manifest = await readMissionManifest(workspaceRoot, missionId);
    if (manifest.state !== "open") {
      return result(
        {
          status: "rejected",
          mission: missionId,
          lane: "full",
          eligibility: {
            eligible: false,
            reasons: [`mission '${missionId}' is not open (state: ${manifest.state})`],
          },
          gates: [],
        },
        1,
        `[mission.content-edit] mission '${missionId}' is not open`,
      );
    }
    systemId = manifest.systemId;
    // content.patch / content.regression.check resolve --site to the *current*
    // mission workpiece — refuse early when the passed mission is not it,
    // otherwise ops could land in a different mission's workpiece.
    const sysState = await readSystemState(workspaceRoot, systemId, io);
    if (sysState.currentMission !== missionId) {
      return result(
        {
          status: "rejected",
          mission: missionId,
          lane: "full",
          eligibility: {
            eligible: false,
            reasons: [
              `mission '${missionId}' is not the site's current mission ` +
                `(system-state.yaml currentMission: ${sysState.currentMission ?? "none"})`,
            ],
          },
          gates: [],
        },
        1,
        `[mission.content-edit] '${missionId}' is not currentMission for ${systemId}`,
      );
    }
    siteDir = path.join(await resolveMissionDir(workspaceRoot, missionId, io), "workpiece");
    if (!(await io.exists(siteDir))) {
      return result(
        {
          status: "rejected",
          mission: missionId,
          lane: "full",
          eligibility: {
            eligible: false,
            reasons: [`workpiece missing — run mission.materialize first`],
          },
          gates: [],
        },
        1,
        `[mission.content-edit] no workpiece for mission '${missionId}'`,
      );
    }
  } else {
    if (!brief) {
      return result(
        {
          status: "rejected",
          mission: null,
          lane: "full",
          eligibility: { eligible: false, reasons: ["--brief is required with --site"] },
          gates: [],
        },
        1,
        "[mission.content-edit] --brief is required with --site",
      );
    }
    siteDir = resolveCacheClonePath(workspaceRoot, systemId);
  }

  // ── touched set ────────────────────────────────────────────────────────────
  let opsRefs: ContentEditOpRef[] = [];
  if (opsFile) {
    const parsed = await opsRefsFromFile(opsFile, io);
    if (parsed.error) {
      return result(
        {
          status: "rejected",
          mission: missionId,
          lane: "full",
          eligibility: { eligible: false, reasons: [parsed.error] },
          gates: [],
        },
        1,
        `[mission.content-edit] ${parsed.error}`,
      );
    }
    opsRefs = parsed.ops;
  }
  const stagedFiles = missionId ? await workpieceTouchedFiles(siteDir, io) : [];
  if (opsRefs.length === 0 && stagedFiles.length === 0) {
    return result(
      {
        status: "rejected",
        mission: missionId,
        lane: "full",
        eligibility: {
          eligible: false,
          reasons: ["empty touched set — nothing to edit (pass --ops-file or stage changes)"],
        },
        gates: [],
      },
      1,
      "[mission.content-edit] empty touched set",
    );
  }

  // ── eligibility (live manifest, evaluated per invocation) ──────────────────
  const eligibility = await evaluateContentEditEligibility({
    siteDir,
    files: stagedFiles,
    ops: opsRefs,
    io,
  });
  if (!eligibility.eligible) {
    return result(
      {
        status: "rejected",
        mission: missionId,
        lane: "full",
        eligibility,
        gates: [],
      },
      1,
      `[mission.content-edit] lane: full — ${eligibility.reasons.join("; ")}`,
    );
  }

  // ── dry-run: eligibility + read-only gates, zero writes ────────────────────
  if (dryRun) {
    const gates: ContentEditGate[] = [{ gate: "eligibility", status: "pass", violations: 0 }];
    if (missionId) {
      const creg = await step(workspaceRoot, "content.regression.check", [
        `--site=${systemId}`,
        "--dry-run",
      ]);
      gates.push({
        gate: "content-regression",
        status: creg.exitCode === 0 ? "pass" : "fail",
        violations: creg.exitCode === 0 ? 0 : 1,
      });
    }
    return result(
      { status: "dry-run", mission: missionId, lane: "fast", eligibility, gates },
      gates.some((g) => g.status === "fail") ? 1 : 0,
      `[mission.content-edit] dry-run — eligible; gates reported, nothing written`,
    );
  }

  // ── open (site path) ───────────────────────────────────────────────────────
  const gates: ContentEditGate[] = [];
  if (!missionId) {
    const open = await step(workspaceRoot, "mission.open", [
      `--system=${systemId}`,
      `--brief=${brief}`,
      `--actor=${actor}`,
      "--lane=content",
    ]);
    if (open.exitCode !== 0 || typeof open.data?.missionId !== "string") {
      return result(
        {
          status: "gate-failed",
          mission: null,
          lane: "fast",
          eligibility,
          gates: [{ gate: "mission.open", status: "fail" }],
        },
        1,
        `[mission.content-edit] mission.open failed: ${open.summary ?? "no mission id"}`,
      );
    }
    missionId = open.data.missionId;
    siteDir = path.join(await resolveMissionDir(workspaceRoot, missionId, io), "workpiece");
    logger.info(`  [content-edit] opened ${missionId} (lane: content)`);
  }

  const fail = (gate: string, summary: string) =>
    result(
      { status: "gate-failed", mission: missionId, lane: "fast", eligibility, gates },
      1,
      `[mission.content-edit] ${gate} failed — ${summary} (mission ${missionId} stays open)`,
    );

  // ── gates 1–2: ops pipeline (per-op validation + author validators) ────────
  if (opsFile) {
    const patch = await step(workspaceRoot, "content.patch", [
      `--site=${systemId}`,
      `--ops-file=${opsFile}`,
    ]);
    const patchData = patch.data as
      | {
          status?: string;
          diagnostics?: Array<{ severity?: string }>;
          validators?: Array<{ command: string; status: string; violations: number }>;
        }
      | undefined;
    const patchViolations = (patchData?.diagnostics ?? []).filter(
      (d) => d.severity === "error",
    ).length;
    gates.push({
      gate: "content-ops",
      status: patch.exitCode === 0 ? "pass" : "fail",
      violations: patchViolations,
    });
    if (patch.exitCode !== 0) {
      return fail("content-ops", patch.summary ?? "content.patch reported blocking diagnostics");
    }
    const validatorViolations = (patchData?.validators ?? []).reduce(
      (sum, v) => sum + (v.violations ?? 0),
      0,
    );
    gates.push({ gate: "author-validators", status: "pass", violations: validatorViolations });
  }

  // ── gate 3: content regression vs golden snapshot (blocking, AC-3) ─────────
  const creg = await step(workspaceRoot, "content.regression.check", [`--site=${systemId}`]);
  const cregData = creg.data as
    { diagnostics?: Array<{ severity?: string; ruleId?: string }> } | undefined;
  const cregViolations = (cregData?.diagnostics ?? []).filter((d) => d.severity === "error").length;
  gates.push({
    gate: "content-regression",
    status: creg.exitCode === 0 ? "pass" : "fail",
    violations: cregViolations || (creg.exitCode === 0 ? 0 : 1),
  });
  if (creg.exitCode !== 0) {
    return fail(
      "content-regression",
      `${creg.summary ?? "drift detected"} — resolved-content drift requires the RFC-0734 review disposition (review.yaml); the fast lane does not auto-accept`,
    );
  }

  // ── gate 4: deploy-preflight (advisory by contract) ────────────────────────
  const preflight = await step(workspaceRoot, "mission.deploy-preflight", [
    `--mission=${missionId}`,
  ]);
  const preflightViolations =
    typeof (preflight.data as { totalViolations?: number } | undefined)?.totalViolations ===
    "number"
      ? (preflight.data as { totalViolations: number }).totalViolations
      : preflight.exitCode === 0
        ? 0
        : 1;
  gates.push({
    gate: "deploy-preflight",
    status: preflightViolations === 0 ? "pass" : "advisory",
    violations: preflightViolations,
  });

  // ── gate 5: commit (its own pre-commit gates included) ─────────────────────
  const commit = await step(workspaceRoot, "mission.git.commit", [
    `--mission=${missionId}`,
    `--message=${message ?? brief ?? `content-edit ${missionId}`}`,
    `--actor=${actor}`,
  ]);
  gates.push({
    gate: "mission.git.commit",
    status: commit.exitCode === 0 ? "pass" : "fail",
  });
  if (commit.exitCode !== 0) {
    return fail("mission.git.commit", commit.summary ?? "commit failed");
  }
  const commitSha = typeof commit.data?.commitSha === "string" ? commit.data.commitSha : undefined;

  // ── persist the fast-lane gate record (gates 1–5) before reconcile ─────────
  const manifest = await readMissionManifest(workspaceRoot, missionId);
  manifest.fastLane = {
    green: true,
    gates: gates.map((g) => ({ gate: g.gate, status: g.status, violations: g.violations })),
    recordedAt: new Date().toISOString(),
  };
  await writeMissionManifest(workspaceRoot, manifest, io);

  // ── gate 6: reconcile (accepts the fast-lane record via the shared predicate)
  const reconcile = await step(workspaceRoot, "mission.reconcile", [
    `--mission=${missionId}`,
    `--actor=${actor}`,
  ]);
  gates.push({
    gate: "mission.reconcile",
    status: reconcile.exitCode === 0 ? "pass" : "fail",
  });
  if (reconcile.exitCode !== 0) {
    return fail("mission.reconcile", reconcile.summary ?? "reconcile failed");
  }

  // ── gate 7: close — only once the site activated the lane (rollout step 2–3)
  const state = await readSystemState(workspaceRoot, systemId, io);
  const laneState = state.contentEditLane ?? "advisory";
  if (laneState !== "active") {
    // Refresh the record so audit shows the full gate set including reconcile.
    manifest.fastLane = {
      green: true,
      gates: gates.map((g) => ({ gate: g.gate, status: g.status, violations: g.violations })),
      recordedAt: new Date().toISOString(),
    };
    await writeMissionManifest(workspaceRoot, manifest, io);
    return result(
      {
        status: "fast-lane-ready",
        mission: missionId,
        lane: "fast",
        eligibility,
        gates,
        commit: commitSha,
        reconciled: true,
        closed: false,
      },
      0,
      `[mission.content-edit] fast-lane gates green for ${missionId} — close via standard flow ` +
        `(system-state.yaml contentEditLane: ${laneState}; set to "active" to close fast-lane missions)`,
    );
  }

  const close = await step(workspaceRoot, "mission.close", [
    `--mission=${missionId}`,
    `--actor=${actor}`,
  ]);
  gates.push({ gate: "mission.close", status: close.exitCode === 0 ? "pass" : "fail" });
  if (close.exitCode !== 0) {
    return fail("mission.close", close.summary ?? "close failed");
  }

  return result(
    {
      status: "closed",
      mission: missionId,
      lane: "fast",
      eligibility,
      gates,
      commit: commitSha,
      reconciled: true,
      closed: true,
    },
    0,
    `[mission.content-edit] ${missionId} closed on the content fast lane ` +
      `(${gates.filter((g) => g.status === "pass").length}/${gates.length} gates green)`,
  );
}
