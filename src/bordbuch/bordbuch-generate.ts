/*
<MODULE_CONTRACT>
<purpose>RFC-0473: bordbuch.generate — write rich public Bordbuch projections from the unified ledger.</purpose>
<non-goals>
  <item>Does not validate the hash-chain — use bordbuch.validate for that.</item>
  <item>Does not append events — use bordbuch.append for that.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0473: initial bordbuch.generate command handler.</item>
</CHANGE_SUMMARY>
*/

import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { writeFileIfChanged } from "@warpgogol/werkstatt-engine/kernel";
import { stringify as yamlStringify } from "yaml";
import type { BordbuchEntry } from "@warpgogol/werkstatt-engine/schemas";
import { readBordbuch, resolveBordbuchProjectionDir } from "./bordbuch-io.ts";
import {
  loadSurfaceModuleContexts,
  readVisibilityOutcomes,
} from "@warpgogol/werkstatt-shared/surface/io";
import type { SurfaceModuleContext } from "@warpgogol/werkstatt-shared/surface";
import { acquireLock, releaseLock, generateOperationId } from "../werkstatt/index.ts";

const FREEZE_FILE = "src/surface/freeze.generated.yaml";

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface BordbuchProjection {
  site: string;
  generatedAt: string | null;
  ledgerHash: string | null;
  eventCount: number;
  latestEvent?: BordbuchEntry;
  pseo: {
    modules: Array<{
      id: string;
      entitlement: string;
      masterLocale: string;
      publishedLocales: string[];
      blueprints: string[];
    }>;
    generationQueues: Record<string, unknown>;
    translationQueues: Record<string, unknown>;
    visibility: {
      outcomes: number;
      actions: Record<string, number>;
      frozenScopes: number;
    };
  };
  validation: { error: number; warning: number; info: number };
  latestStellarpass?: { hash: string; occurredAt: string };
  latestDeploy?: { eventId: string; occurredAt: string; status: string };
  openEscalations: BordbuchEntry[];
}

async function buildProjection(
  workspaceRoot: string,
  systemId: string,
  entries: BordbuchEntry[],
): Promise<BordbuchProjection> {
  const systemDir = await resolveBordbuchProjectionDir(workspaceRoot, systemId);
  const moduleContexts = await loadSurfaceModuleContexts(systemDir).catch(() => ({
    modules: {},
    declaredBlueprints: [],
    supportedLocales: [],
  }));
  const modules = Object.values(moduleContexts.modules).map((module: SurfaceModuleContext) => ({
    id: module.id,
    entitlement: module.entitlement,
    masterLocale: module.masterLocale,
    publishedLocales: module.publishedLocales,
    blueprints: module.blueprints,
  }));
  const latestEvent = entries.at(-1);
  const latestDeploy = [...entries].reverse().find((e) => e.kind === "deployment");
  const openEscalations = entries.filter((e) => e.status === "escalated" || e.status === "waiting");
  const visibilityOutcomes = await readVisibilityOutcomes(systemDir);
  const actions: Record<string, number> = {};
  for (const outcome of visibilityOutcomes?.outcomes ?? []) {
    actions[outcome.proposedAction] = (actions[outcome.proposedAction] ?? 0) + 1;
  }
  let frozenScopes = 0;
  try {
    const freezePath = join(systemDir, FREEZE_FILE);
    if (existsSync(freezePath)) {
      const freeze = JSON.parse(await readFile(freezePath, "utf8")) as { frozen?: unknown[] };
      frozenScopes = Array.isArray(freeze.frozen) ? freeze.frozen.length : 0;
    }
  } catch {
    frozenScopes = 0;
  }
  const projection: BordbuchProjection = {
    site: systemId,
    generatedAt: null,
    ledgerHash: latestEvent?.hash ?? null,
    eventCount: entries.length,
    ...(latestEvent ? { latestEvent } : {}),
    pseo: {
      modules,
      generationQueues: {},
      translationQueues: {},
      visibility: {
        outcomes: visibilityOutcomes?.outcomes.length ?? 0,
        actions,
        frozenScopes,
      },
    },
    validation: { error: 0, warning: 0, info: 0 },
    ...(latestDeploy
      ? {
          latestDeploy: {
            eventId: latestDeploy.id,
            occurredAt: latestDeploy.occurredAt,
            status: latestDeploy.status,
          },
        }
      : {}),
    openEscalations,
  };
  return projection;
}

function renderHtml(projection: BordbuchProjection, entries: readonly BordbuchEntry[]): string {
  const items = [...entries]
    .reverse()
    .map(
      (entry) =>
        `<li id="${escapeHtml(entry.id)}"><strong>${escapeHtml(entry.summary)}</strong><br>` +
        `<span>${escapeHtml(entry.occurredAt)} · ${escapeHtml(entry.kind)} · ${escapeHtml(entry.status)}</span></li>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="robots" content="noindex,nofollow">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Bordbuch · ${escapeHtml(projection.site)}</title>
</head>
<body>
  <main>
    <h1>Bordbuch · ${escapeHtml(projection.site)}</h1>
    <p>Ledger hash: ${escapeHtml(projection.ledgerHash ?? "none")} · events: ${projection.eventCount}</p>
    <h2>PSEO Modules</h2>
    <ul>${projection.pseo.modules
      .map(
        (module) =>
          `<li>${escapeHtml(module.id)} · master ${escapeHtml(module.masterLocale)} · ${escapeHtml(module.blueprints.join(", "))}</li>`,
      )
      .join("")}</ul>
    <h2>Recent Events</h2>
    <ol>${items}</ol>
  </main>
</body>
</html>
`;
}

export async function runBordbuchGenerate(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult> {
  const { workspaceRoot, logger } = context;
  const systemId = flagString(input, "system") ?? context.site?.name;

  if (!systemId) throw new Error("[bordbuch.generate] --system is required");

  const operationId = generateOperationId();
  await acquireLock(workspaceRoot, `system:${systemId}`, operationId, "bordbuch.generate", "agent");
  await acquireLock(
    workspaceRoot,
    `bordbuch:${systemId}`,
    operationId,
    "bordbuch.generate",
    "agent",
  );

  try {
    const entries = await readBordbuch(workspaceRoot, systemId);
    const projection = await buildProjection(workspaceRoot, systemId, entries);

    const projectionDir = await resolveBordbuchProjectionDir(workspaceRoot, systemId);
    const baseDir = join(projectionDir, "public", ".well-known");
    const jsonPath = join(baseDir, "bordbuch.json");
    const htmlPath = join(baseDir, "bordbuch", "index.html");
    const statusPath = join(projectionDir, "bordbuch", "status.generated.yaml");

    await mkdir(dirname(jsonPath), { recursive: true });
    await mkdir(dirname(htmlPath), { recursive: true });
    await mkdir(dirname(statusPath), { recursive: true });

    const json = `${JSON.stringify(projection, null, 2)}\n`;
    const html = renderHtml(projection, entries);
    const yaml = `${yamlStringify(projection)}`;

    await writeFileIfChanged(jsonPath, json);
    await writeFileIfChanged(htmlPath, html);
    await writeFileIfChanged(statusPath, yaml);

    logger.success(`[bordbuch.generate] wrote projections for ${systemId}`);

    return {
      summary: `[bordbuch.generate] wrote bordbuch.json, bordbuch/index.html, status.generated.yaml for ${systemId}`,
      nextSteps: [
        {
          action: `Commit the bordbuch projections: pnpm exec werkstatt run bordbuch.commit --site ${systemId}`,
          kind: "optional",
        },
      ],
    };
  } finally {
    await releaseLock(workspaceRoot, `bordbuch:${systemId}`);
    await releaseLock(workspaceRoot, `system:${systemId}`);
  }
}
