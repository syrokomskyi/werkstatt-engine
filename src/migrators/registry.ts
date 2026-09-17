/*
<MODULE_CONTRACT>
<purpose>RFC-0479: the migrator registry — forward-only codemods keyed by RFC-id,
ordered by RFC-id (numeric). Replaces the old RFC-0221 SemVer-based registry.</purpose>
<non-goals>
  <item>Do not apply migrators here — selection only.</item>
  <item>Do not delete migrators — the registry is append-only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0548: register rfc-0548 migrator (backup AGENTS.md and regenerate with behavioral layer).</item>
  <item>RFC-0757: register rfc-0757 no-op migrator (send-message checklistItems generalization, advances cursor).</item>
  <item>RFC-0885: register rfc-0885 content migrator (consentStatus→consentScope, add default display to Nachweis evidence-source).</item>
  <item>RFC-1105: register rfc-1105 share-path-rewrite migrator (werkstatt-shared share/X → werkstatt-shared/X specifier rewrite in workpieces).</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
  <history>RFC-0221, RFC-0479, RFC-0481, RFC-0483, RFC-0488, RFC-0492, RFC-0495, RFC-0496, RFC-0497, RFC-0498, RFC-0500, RFC-0501, RFC-0502, RFC-0504, RFC-0505, RFC-0506, RFC-0508, RFC-0512, RFC-0514, RFC-0529, RFC-0572</history>
</CHANGE_SUMMARY>
*/

import type { Migrator } from "./types.ts";
import { rfc0479Migrator } from "./rfc-0479.ts";
import { rfc0481Migrator } from "./rfc-0481.ts";
import { rfc0483Migrator } from "./rfc-0483.ts";
import { rfc0488Migrator } from "./rfc-0488.ts";
import { rfc0492Migrator } from "./rfc-0492.ts";
import { rfc0495Migrator } from "./rfc-0495.ts";
import { rfc0496Migrator } from "./rfc-0496.ts";
import { rfc0497Migrator } from "./rfc-0497.ts";
import { rfc0498Migrator } from "./rfc-0498.ts";
import { rfc0500Migrator } from "./rfc-0500.ts";
import { rfc0501Migrator } from "./rfc-0501.ts";
import { rfc0502Migrator } from "./rfc-0502.ts";
import { rfc0504Migrator } from "./rfc-0504.ts";
import { rfc0505Migrator } from "./rfc-0505.ts";
import { rfc0506Migrator } from "./rfc-0506.ts";
import { rfc0508Migrator } from "./rfc-0508.ts";
import { rfc0512Migrator } from "./rfc-0512.ts";
import { rfc0514Migrator } from "./rfc-0514.ts";
import { rfc0572Migrator } from "./rfc-0572.ts";
import { rfc0529Migrator } from "./rfc-0529.ts";
import { rfc0548Migrator } from "./rfc-0548.ts";
import { rfc0757Migrator } from "./rfc-0757.ts";
import { rfc0885Migrator } from "./rfc-0885.ts";
import { rfc1105Migrator } from "./rfc-1105.ts";

export const migratorRegistry: readonly Migrator[] = [
  rfc0479Migrator,
  rfc0481Migrator,
  rfc0483Migrator,
  rfc0488Migrator,
  rfc0492Migrator,
  rfc0495Migrator,
  rfc0496Migrator,
  rfc0497Migrator,
  rfc0498Migrator,
  rfc0500Migrator,
  rfc0501Migrator,
  rfc0502Migrator,
  rfc0504Migrator,
  rfc0505Migrator,
  rfc0506Migrator,
  rfc0508Migrator,
  rfc0512Migrator,
  rfc0514Migrator,
  rfc0529Migrator,
  rfc0548Migrator,
  rfc0572Migrator,
  rfc0757Migrator,
  rfc0885Migrator,
  rfc1105Migrator,
];

export function numericRfcId(id: string): number {
  const match = id.match(/^rfc-(\d+)$/i);
  return match ? parseInt(match[1], 10) : 0;
}

export function migratorsToApply(cursor: string[]): Migrator[] {
  return migratorRegistry
    .filter((m) => !cursor.includes(m.id))
    .slice()
    .sort((a, b) => numericRfcId(a.id) - numericRfcId(b.id));
}

export function allMigratorIds(): string[] {
  return migratorRegistry.map((m) => m.id).sort((a, b) => numericRfcId(a) - numericRfcId(b));
}
