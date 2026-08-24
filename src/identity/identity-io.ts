/*
<MODULE_CONTRACT>
  <purpose>RFC-0558: shared I/O helpers for identity config (werkstatt.identity.json)
  read/write and credential ID generation.</purpose>
  <non-goals>
    <item>Do not handle signing — that lives in @warpgogol/werkstatt-shared/passport/identity-sign.</item>
    <item>Do not handle key generation — that lives in @warpgogol/werkstatt-shared/passport/sign.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0558: initial identity I/O helpers.</item>
</CHANGE_SUMMARY>
*/

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  WerkstattIdentityConfigSchema,
  type WerkstattIdentityConfig,
  type WerkstattCredential,
} from "@warpgogol/werkstatt-shared/passport";

export const IDENTITY_CONFIG_FILENAME = "werkstatt.identity.json";

export function identityConfigPath(workspaceRoot: string): string {
  return join(workspaceRoot, IDENTITY_CONFIG_FILENAME);
}

export async function readIdentityConfig(workspaceRoot: string): Promise<WerkstattIdentityConfig> {
  const raw = await readFile(identityConfigPath(workspaceRoot), "utf-8");
  const parsed = JSON.parse(raw);
  return WerkstattIdentityConfigSchema.parse(parsed);
}

export async function writeIdentityConfig(
  workspaceRoot: string,
  config: WerkstattIdentityConfig,
): Promise<void> {
  const path = identityConfigPath(workspaceRoot);
  await writeFile(path, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

export function generateCredentialId(): string {
  return `urn:warpgogol:cred:${randomUUID()}`;
}

export function findCredential(
  config: WerkstattIdentityConfig,
  credentialId: string,
): WerkstattCredential | undefined {
  return config.issuedCredentials.find((c) => c.credentialId === credentialId);
}

export function isRevoked(config: WerkstattIdentityConfig, credentialId: string): boolean {
  return config.revokedCredentialIds.includes(credentialId);
}
