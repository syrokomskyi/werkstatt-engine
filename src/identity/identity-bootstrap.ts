/*
<MODULE_CONTRACT>
  <purpose>RFC-0558: identity.bootstrap — generate operator keypair, write
  werkstatt.identity.json, issue self-ownership SiteOwnershipCredential.</purpose>
  <non-goals>
    <item>Do not issue ActorDelegationCredential — that is identity.credential.issue.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0558: initial identity.bootstrap command handler.</item>
</CHANGE_SUMMARY>
*/

import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { generateKeypair } from "@warpgogol/werkstatt-shared/passport/sign";
import { signIdentityCredential } from "@warpgogol/werkstatt-shared/passport/identity-sign";
import type { WerkstattIdentityConfig, SiteOwnershipCredentialSubject } from "@warpgogol/werkstatt-shared/passport";
import { writeIdentityConfig, generateCredentialId } from "./identity-io.ts";

export interface IdentityBootstrapData {
  operatorName: string;
  domain: string;
  publicKeyMultibase: string;
  keyVersion: string;
  authMode: "permissive";
  selfOwnershipCredentialId: string;
  privateKeyHex: string;
}

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

export async function runIdentityBootstrap(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<IdentityBootstrapData>> {
  const { workspaceRoot } = context;
  const operatorName = flagString(input, "operator-name");
  const domain = flagString(input, "domain");

  if (!operatorName) throw new Error("[identity.bootstrap] --operator-name is required");
  if (!domain) throw new Error("[identity.bootstrap] --domain is required");

  const keypair = await generateKeypair();
  const keyVersion = "v1";
  const operatorDid = `did:web:${domain}#operator-${keyVersion}`;
  const issuedAt = new Date().toISOString();

  const subject: SiteOwnershipCredentialSubject = {
    id: operatorDid,
    siteId: domain,
    role: "owner",
  };

  const proof = await signIdentityCredential(
    subject,
    keypair.privateKeyHex,
    `did:web:${domain}#${keyVersion}`,
    issuedAt,
  );

  const credentialId = generateCredentialId();

  const config: WerkstattIdentityConfig = {
    schemaVersion: "1.0",
    operatorName,
    operatorKeyPair: {
      publicKeyMultibase: keypair.publicKeyMultibase,
      keyVersion,
      algId: "Ed25519Signature2020",
    },
    authMode: "permissive",
    domain,
    issuedCredentials: [
      {
        credentialId,
        type: "SiteOwnershipCredential",
        subject,
        proof,
        issuedAt,
        issuer: `did:web:${domain}`,
      },
    ],
    revokedCredentialIds: [],
  };

  await writeIdentityConfig(workspaceRoot, config);

  return {
    data: {
      operatorName,
      domain,
      publicKeyMultibase: keypair.publicKeyMultibase,
      keyVersion,
      authMode: "permissive",
      selfOwnershipCredentialId: credentialId,
      privateKeyHex: keypair.privateKeyHex,
    },
    exitCode: 0,
    summary: "identity.bootstrap: keypair generated, self-ownership VC issued",
  };
}
