/*
<MODULE_CONTRACT>
<purpose>RFC-0479: migrator.registry.validate — validate the RFC-id-keyed migrator
registry for id uniqueness, RFC-id ordering, and test coverage.</purpose>
<non-goals>
  <item>Do not apply migrators or touch the filesystem.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0479: initial migrator.registry.validate command.</item>
</CHANGE_SUMMARY>
*/

import { existsSync } from "node:fs";
import path from "node:path";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { migratorRegistry, numericRfcId, allMigratorIds } from "../migrators/registry.ts";

export interface MigratorRegistryValidateData {
  migratorCount: number;
  violations: string[];
}

export function runMigratorRegistryValidate(
  _input: KernelCommandInput,
  context: KernelRuntimeContext,
): KernelCommandResult<MigratorRegistryValidateData> {
  const { workspaceRoot, logger } = context;
  const violations: string[] = [];

  logger.section("[migrator.registry.validate]");
  logger.info(`  ${migratorRegistry.length} migrator(s) in registry`);

  const ids = migratorRegistry.map((m) => m.id);
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      violations.push(`duplicate migrator-id: ${id}`);
    }
    seen.add(id);
  }

  const sortedIds = allMigratorIds();
  for (let i = 1; i < sortedIds.length; i++) {
    if (numericRfcId(sortedIds[i]) <= numericRfcId(sortedIds[i - 1])) {
      violations.push(`ordering violation: ${sortedIds[i]} should come after ${sortedIds[i - 1]}`);
    }
  }

  for (const migrator of migratorRegistry) {
    const migratorDir = path.dirname(
      path.resolve(workspaceRoot, "packages/os/site-kernel-handoff/src/migrators/registry.ts"),
    );
    const pbtTestPath = path.join(migratorDir, `${migrator.id}.pbt.test.ts`);
    const snapshotTestPath = path.join(migratorDir, `${migrator.id}.snapshot.test.ts`);

    if (!existsSync(pbtTestPath)) {
      violations.push(`missing PBT test: ${migrator.id}.pbt.test.ts`);
    }
    if (!existsSync(snapshotTestPath)) {
      violations.push(`missing snapshot test: ${migrator.id}.snapshot.test.ts`);
    }
  }

  if (violations.length > 0) {
    for (const v of violations) {
      logger.error(`  ${v}`);
    }
    return {
      data: { migratorCount: migratorRegistry.length, violations },
      exitCode: 1,
      summary: `[migrator.registry.validate] ${violations.length} violation${violations.length === 1 ? "" : "s"}`,
    };
  }

  logger.success("[migrator.registry.validate] OK — no violations");
  return {
    data: { migratorCount: migratorRegistry.length, violations: [] },
    summary: "[migrator.registry.validate] OK — no violations",
  };
}
