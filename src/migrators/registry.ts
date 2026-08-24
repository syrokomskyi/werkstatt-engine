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
  <item>RFC-0221: initial registry mechanism, seeded empty.</item>
  <item>RFC-0479: rewrite to RFC-id-keyed registry with bootstrapping migrator.</item>
  <item>RFC-0481: register rfc-0481 content migrator (PBP business singleton).</item>
  <item>RFC-0483: register rfc-0483 content migrator (reference migration + stopgap removal).</item>
  <item>RFC-0488: register rfc-0488 material credits provenance registry migrator.</item>
  <item>RFC-0492: register rfc-0492 industry dossier schema migrator.</item>
  <item>RFC-0495: register rfc-0495 no-op migrator (URL slug restructuring, advances cursor).</item>
  <item>RFC-0496: register rfc-0496 no-op migrator (website-service surface, advances cursor).</item>
  <item>RFC-0497: register rfc-0497 no-op migrator (intersection records, advances cursor).</item>
  <item>RFC-0498: register rfc-0498 no-op migrator (structured data policy, advances cursor).</item>
  <item>RFC-0500: register rfc-0500 content migrator (topics→articles collection rename + sections→prose conversion).</item>
  <item>RFC-0501: register rfc-0501 content migrator (set existing published articles to review-required).</item>
  <item>RFC-0502: register rfc-0502 content migrator (create initial author record file).</item>
  <item>RFC-0504: register rfc-0504 content migrator (articleSections/changelog fields + H1 stripping).</item>
  <item>RFC-0505: register rfc-0505 content migrator (claim sidecar to claim record transformation + sidecar deletion).</item>
  <item>RFC-0506: register rfc-0506 no-op migrator (ratgeber article JSON-LD C-contract change, advances cursor).</item>
  <item>RFC-0508: register rfc-0508 content migrator (Person→Participant fields: participantType, status, visibility, relationshipType, consent).</item>
  <item>RFC-0512: register rfc-0512 no-op migrator (team JSON endpoints + Schema.org C-contract change, advances cursor).</item>
  <item>RFC-0514: register rfc-0514 content migrator (send-message emailField + contactRequirementMessage removal).</item>
  <item>RFC-0572: register rfc-0572 content migrator (send-message emailField/phoneField removal + contactRequirementMessage re-add).</item>
  <item>RFC-0529: register rfc-0529 content migrator (brace-delimited to braceless content reference syntax migration).</item>
  <item>RFC-0548: register rfc-0548 migrator (backup AGENTS.md and regenerate with behavioral layer).</item>
  <item>RFC-0757: register rfc-0757 no-op migrator (send-message checklistItems generalization, advances cursor).</item>
  <item>RFC-0885: register rfc-0885 content migrator (consentStatus→consentScope, add default display to Nachweis evidence-source).</item>
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
