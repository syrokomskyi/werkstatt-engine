/*
<MODULE_CONTRACT>
<purpose>RFC-1030: thin kernel command handlers for runtime.reflect.* commands.
  Each handler delegates to the pure functions in reflection.ts (reflectRuntime,
  createCapabilityCatalog) and wraps the result in KernelCommandResult.</purpose>
<non-goals>
  <item>Does not implement business logic — all logic lives in reflection.ts.</item>
  <item>Does not register commands — registration lives in component-runtime.module.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1030: initial implementation — 5 reflection command handlers.</item>
</CHANGE_SUMMARY>
*/

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "../kernel/types.ts";
import {
  createCapabilityCatalog,
  reflectRuntime,
  assertNoForbiddenFields,
  type LawKernelSummary,
  type ReflectionInput,
  type RuntimeReflectionV1,
  type CapabilityCatalogV1,
} from "./reflection.ts";

export interface ReflectionCommandContext {
  reflectionInput: ReflectionInput;
  lawKernelSummary: LawKernelSummary;
}

function parseContext(context: KernelRuntimeContext): ReflectionCommandContext {
  const ctx = context as unknown as { reflectionInput?: ReflectionInput; lawKernelSummary?: LawKernelSummary };
  if (!ctx.reflectionInput) {
    throw new Error("REFLECTION-CMD-01: reflectionInput not provided in kernel context");
  }
  if (!ctx.lawKernelSummary) {
    throw new Error("REFLECTION-CMD-02: lawKernelSummary not provided in kernel context");
  }
  return { reflectionInput: ctx.reflectionInput, lawKernelSummary: ctx.lawKernelSummary };
}

export function runReflectGraph(
  _input: KernelCommandInput,
  context: KernelRuntimeContext,
): KernelCommandResult<RuntimeReflectionV1> {
  const { reflectionInput, lawKernelSummary } = parseContext(context);
  const reflection = reflectRuntime(reflectionInput, lawKernelSummary);
  assertNoForbiddenFieldsReflection(reflection);
  return { data: reflection, exitCode: 0, summary: `Reflected ${reflection.components.length} components` };
}

export function runReflectCapabilities(
  _input: KernelCommandInput,
  context: KernelRuntimeContext,
): KernelCommandResult<CapabilityCatalogV1> {
  const { reflectionInput } = parseContext(context);
  const catalog = createCapabilityCatalog(reflectionInput);
  assertNoForbiddenFields(catalog);
  return { data: catalog, exitCode: 0, summary: `Catalog has ${catalog.entries.length} entries` };
}

export function runReflectHealth(
  _input: KernelCommandInput,
  context: KernelRuntimeContext,
): KernelCommandResult<RuntimeReflectionV1> {
  const { reflectionInput, lawKernelSummary } = parseContext(context);
  const reflection = reflectRuntime(reflectionInput, lawKernelSummary);
  const healthResults = reflection.components.map((c) => ({
    componentId: c.componentId,
    health: c.health ?? { status: "unknown" as const },
  }));
  return { data: { ...reflection, components: healthResults as never }, exitCode: 0, summary: `Health checked ${healthResults.length} components` };
}

export function runReflectFibers(
  _input: KernelCommandInput,
  context: KernelRuntimeContext,
): KernelCommandResult<Array<{ componentId: string; fiberState: string }>> {
  const { reflectionInput, lawKernelSummary } = parseContext(context);
  const reflection = reflectRuntime(reflectionInput, lawKernelSummary);
  const fibers = reflection.components.map((c) => ({
    componentId: c.componentId,
    fiberState: c.fiberState,
  }));
  return { data: fibers, exitCode: 0, summary: `${fibers.length} fiber states` };
}

export function runReflectCatalogGenerate(
  _input: KernelCommandInput,
  context: KernelRuntimeContext,
): KernelCommandResult<{ path: string }> {
  const { reflectionInput } = parseContext(context);
  const catalog = createCapabilityCatalog(reflectionInput);
  assertNoForbiddenFields(catalog);

  const outputPath = join(context.workspaceRoot, "docs", "runtime-catalog.generated.yaml");
  const yaml = catalogToYaml(catalog);
  writeFileSync(outputPath, yaml, "utf-8");

  return { data: { path: "docs/runtime-catalog.generated.yaml" }, exitCode: 0, summary: `Catalog written to docs/runtime-catalog.generated.yaml (${catalog.entries.length} entries)` };
}

function assertNoForbiddenFieldsReflection(reflection: RuntimeReflectionV1): void {
  const json = JSON.stringify(reflection);
  const forbidden = ["secrets", "credentials", "privateState", "rawGrants", "prompts", "executableBytes", "leaseTokens", "authorityMaterial", "artifactBytes", "sourceCode"];
  for (const field of forbidden) {
    if (json.includes(field)) {
      throw new Error(`REFLECTION-02: reflection contains forbidden field name: ${field}`);
    }
  }
}

function catalogToYaml(catalog: CapabilityCatalogV1): string {
  const lines: string[] = [
    `schema: ${catalog.schema}`,
    `observedAt: ${catalog.observedAt}`,
    `resolvedComponentSetHash: ${catalog.resolvedComponentSetHash}`,
    `catalogHash: ${catalog.catalogHash}`,
    `entries:`,
  ];
  for (const entry of catalog.entries) {
    lines.push(`  - capability: ${entry.capability}`);
    lines.push(`    version: ${entry.version}`);
    lines.push(`    schemaHash: ${entry.schemaHash}`);
    lines.push(`    componentId: ${entry.componentId}`);
    lines.push(`    lifecycleState: ${entry.lifecycleState}`);
    lines.push(`    callable: ${entry.callable}`);
  }
  return lines.join("\n") + "\n";
}
