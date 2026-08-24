/*
<MODULE_CONTRACT>
  <purpose>RFC-0558: identity.credential.issue — issue a SiteOwnershipCredential
  or ActorDelegationCredential and append it to werkstatt.identity.json.</purpose>
  <non-goals>
    <item>Do not verify credentials — that is identity.credential.verify.</item>
    <item>Do not revoke credentials — that is identity.credential.revoke.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0558: initial identity.credential.issue command handler.</item>
</CHANGE_SUMMARY>
*/

import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { signIdentityCredential } from "@warpgogol/werkstatt-shared/passport/identity-sign";
import type {
  WerkstattCredential,
  SiteOwnershipCredentialSubject,
  ActorDelegationCredentialSubject,
  IdentityCredentialSubject,
} from "@warpgogol/werkstatt-shared/passport";
import { readIdentityConfig, writeIdentityConfig, generateCredentialId } from "./identity-io.ts";

export interface IdentityCredentialIssueData {
  credentialId: string;
  type: "SiteOwnershipCredential" | "ActorDelegationCredential";
  subjectId: string;
  siteId: string;
}

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

export async function runIdentityCredentialIssue(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<IdentityCredentialIssueData>> {
  const { workspaceRoot } = context;
  const type = flagString(input, "type");
  const subjectId = flagString(input, "subject");
  const siteId = flagString(input, "site");
  const scopesRaw = flagString(input, "scopes");
  const expiresAt = flagString(input, "expires-at");

  if (!type) throw new Error("[identity.credential.issue] --type is required");
  if (!subjectId) throw new Error("[identity.credential.issue] --subject is required");
  if (!siteId) throw new Error("[identity.credential.issue] --site is required");

  const privateKeyHex = process.env["PASSPORT_SIGNING_KEY"];
  if (!privateKeyHex) {
    throw new Error("[identity.credential.issue] PASSPORT_SIGNING_KEY env var is required");
  }

  const config = await readIdentityConfig(workspaceRoot);
  const issuedAt = new Date().toISOString();

  let subject: IdentityCredentialSubject;
  let credentialType: WerkstattCredential["type"];

  if (type === "SiteOwnershipCredential") {
    subject = { id: subjectId, siteId, role: "owner" } satisfies SiteOwnershipCredentialSubject;
    credentialType = "SiteOwnershipCredential";
  } else if (type === "ActorDelegationCredential") {
    if (!expiresAt) {
      throw new Error(
        "[identity.credential.issue] --expires-at is required for ActorDelegationCredential",
      );
    }
    const scopes = scopesRaw ? scopesRaw.split(",").map((s) => s.trim()) : ["*"];
    subject = {
      id: subjectId,
      siteId,
      delegatedBy:
        config.issuedCredentials[0]?.subject.id ?? `did:web:${config.domain}#operator-v1`,
      expiresAt,
      scopes,
    } satisfies ActorDelegationCredentialSubject;
    credentialType = "ActorDelegationCredential";
  } else {
    throw new Error(
      `[identity.credential.issue] --type must be SiteOwnershipCredential or ActorDelegationCredential, got: ${type}`,
    );
  }

  const verificationMethod = `did:web:${config.domain}#${config.operatorKeyPair.keyVersion}`;
  const proof = await signIdentityCredential(subject, privateKeyHex, verificationMethod, issuedAt);

  const credentialId = generateCredentialId();
  const credential: WerkstattCredential = {
    credentialId,
    type: credentialType,
    subject,
    proof,
    issuedAt,
    issuer: `did:web:${config.domain}`,
  };

  config.issuedCredentials.push(credential);
  await writeIdentityConfig(workspaceRoot, config);

  return {
    data: {
      credentialId,
      type: credentialType,
      subjectId,
      siteId,
    },
    exitCode: 0,
    summary: `identity.credential.issue: ${credentialType} issued for ${subjectId}`,
  };
}
