/*
<MODULE_CONTRACT>
<purpose>RFC-0715: Shared types and re-exports for N3 cryptographic verification commands.</purpose>
<keywords>nachweis, n3, crypto, signature, timestamp, types</keywords>
<responsibilities>
  <item>Defines result interfaces for nachweis.sign, nachweis.timestamp, nachweis.verify-signature.</item>
  <item>Re-exports common helpers from nachweis-io.ts to avoid circular imports.</item>
</responsibilities>
<non-goals>
  <item>Does not define command handlers — those live in nachweis-*.ts files.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0715: initial N3 shared types module.</item>
  <item>RFC-0715 review fix: add shared flagString/flagBool helpers to eliminate duplication across command files.</item>
  <item>RFC-0871: add TimestampAssurance type, extend NachweisTimestampResult and NachweisVerifySignatureResult with assurance metadata.</item>
</CHANGE_SUMMARY>
*/

import type { KernelCommandInput } from "@warpgogol/werkstatt-engine/kernel";

export {
  isNachweisEntitled,
  makeSkipResult,
  resolveNachweisCachePath,
  resolveDefaultLang,
  resolvePbpEntityDir,
} from "./nachweis-io.ts";

export function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

export function flagBool(input: KernelCommandInput, key: string): boolean {
  const v = input.flags[key];
  return v === true || v === "true";
}

export interface NachweisSignResult {
  slug: string;
  systemId: string;
  signatureHex: string;
  publicKeyHex: string;
  bordbuchEventId: string | null;
  idempotent: boolean;
}

export type TimestampAssurance = "rfc3161" | "eidas-qualified";

export interface NachweisTimestampResult {
  slug: string;
  systemId: string;
  timestampTokenBase64: string;
  tsaUrl: string;
  bordbuchEventId: string | null;
  idempotent: boolean;
  timestampAssurance: TimestampAssurance;
  qualificationEvidenceRef?: string;
}

export interface NachweisVerifySignatureResult {
  slug: string;
  systemId: string;
  signatureValid: boolean;
  timestampVerified: boolean;
  timestampAssurance: TimestampAssurance;
  qualificationEvidenceRef?: string;
  publicKeyHex: string | null;
  details: string;
}
