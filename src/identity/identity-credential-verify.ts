/*
<MODULE_CONTRACT>
  <purpose>RFC-0558: identity.credential.verify — verify a credential's
  signature, revocation status, and expiry.</purpose>
  <non-goals>
    <item>Do not issue credentials — that is identity.credential.issue.</item>
    <item>Do not revoke credentials — that is identity.credential.revoke.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0558: initial identity.credential.verify command handler.</item>
</CHANGE_SUMMARY>
*/

import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { verifyIdentityCredential } from "@warpgogol/werkstatt-shared/passport/identity-sign";
import { readIdentityConfig, findCredential, isRevoked } from "./identity-io.ts";

export interface IdentityCredentialVerifyData {
  credentialId: string;
  valid: boolean;
  error?: string;
  expiredAt?: string;
}

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

export async function runIdentityCredentialVerify(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<IdentityCredentialVerifyData>> {
  const { workspaceRoot } = context;
  const credentialId = flagString(input, "credential-id");

  if (!credentialId) throw new Error("[identity.credential.verify] --credential-id is required");

  const config = await readIdentityConfig(workspaceRoot);
  const credential = findCredential(config, credentialId);

  if (!credential) {
    return {
      data: { credentialId, valid: false, error: "not-found" },
      exitCode: 0,
      summary: "identity.credential.verify: credential not found",
    };
  }

  if (isRevoked(config, credentialId)) {
    return {
      data: { credentialId, valid: false, error: "revoked" },
      exitCode: 0,
      summary: "identity.credential.verify: credential revoked",
    };
  }

  if (credential.type === "ActorDelegationCredential" && "expiresAt" in credential.subject) {
    const expiresAt = credential.subject.expiresAt;
    if (new Date(expiresAt).getTime() < Date.now()) {
      return {
        data: { credentialId, valid: false, error: "expired", expiredAt: expiresAt },
        exitCode: 0,
        summary: "identity.credential.verify: credential expired",
      };
    }
  }

  const signatureValid = await verifyIdentityCredential(
    credential.subject,
    credential.proof,
    config.operatorKeyPair.publicKeyMultibase,
  );

  if (!signatureValid) {
    return {
      data: { credentialId, valid: false, error: "signature-invalid" },
      exitCode: 0,
      summary: "identity.credential.verify: signature invalid",
    };
  }

  return {
    data: { credentialId, valid: true },
    exitCode: 0,
    summary: "identity.credential.verify: credential valid",
  };
}
