/*
<MODULE_CONTRACT>
  <purpose>RFC-0558: identity.credential.revoke — add a credential id to the
  revocation list in werkstatt.identity.json.</purpose>
  <non-goals>
    <item>Do not delete the credential — revocation is a status change, not removal.</item>
    <item>Do not verify credentials — that is identity.credential.verify.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0558: initial identity.credential.revoke command handler.</item>
  <item>RFC-1249: wire werkstatt.commands.validate into packages.check + retire CMD-OUTPUT debt</item>
</CHANGE_SUMMARY>
*/

import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import {
  readIdentityConfig,
  writeIdentityConfig,
  findCredential,
  isRevoked,
} from "./identity-io.ts";
import { failResult } from "@warpgogol/werkstatt-shared/checks/result-helpers";

export interface IdentityCredentialRevokeData {
  credentialId: string;
  revoked: boolean;
}

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

export async function runIdentityCredentialRevoke(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<IdentityCredentialRevokeData>> {
  const { workspaceRoot } = context;
  const credentialId = flagString(input, "credential-id");

  if (!credentialId) throw new Error("[identity.credential.revoke] --credential-id is required");

  const config = await readIdentityConfig(workspaceRoot);
  const credential = findCredential(config, credentialId);

  if (!credential) {
    return {
      ...failResult("identity.credential.revoke", [`credential '${credentialId}' not found`]),
      data: { credentialId, revoked: false },
    };
  }

  if (isRevoked(config, credentialId)) {
    return {
      data: { credentialId, revoked: true },
      exitCode: 0,
      summary: `[identity.credential.revoke] credential '${credentialId}' already revoked`,
    };
  }

  config.revokedCredentialIds.push(credentialId);
  await writeIdentityConfig(workspaceRoot, config);

  return {
    data: { credentialId, revoked: true },
    exitCode: 0,
    summary: `[identity.credential.revoke] credential '${credentialId}' revoked`,
  };
}
