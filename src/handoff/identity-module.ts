/*
<MODULE_CONTRACT>
  <purpose>RFC-0558: identity kernel module — registers identity.bootstrap,
  identity.credential.issue, identity.credential.verify, identity.credential.revoke
  commands for VC-based actor identity and site ownership.</purpose>
  <non-goals>
    <item>Do not register mission, sternsystem, or handoff commands — those have their own modules.</item>
    <item>Do not handle key storage — private keys arrive via PASSPORT_SIGNING_KEY env var.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0558: initial identity module with 4 commands.</item>
</CHANGE_SUMMARY>
*/

import type { KernelModule } from "@warpgogol/werkstatt-engine/kernel";

export function createIdentityModule(): KernelModule {
  return {
    name: "identity",
    version: "0.1.0",
    async register(registry) {
      const { runIdentityBootstrap } = await import("../identity/identity-bootstrap.ts");
      const { runIdentityCredentialIssue } =
        await import("../identity/identity-credential-issue.ts");
      const { runIdentityCredentialVerify } =
        await import("../identity/identity-credential-verify.ts");
      const { runIdentityCredentialRevoke } =
        await import("../identity/identity-credential-revoke.ts");

      registry.registerCommand({
        name: "identity.bootstrap",
        modulePath: "packages/werkstatt-engine/src/handoff/identity-module.ts",
        generates: [],
        description:
          "Generate operator keypair, write werkstatt.identity.json, issue self-ownership VC (RFC-0558).",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: true,
        flags: {
          "operator-name": {
            kind: "string",
            required: true,
            description: "Operator display name.",
          },
          domain: {
            kind: "string",
            required: true,
            description: "Domain for did:web identifiers (e.g. warpgogol.com).",
          },
        },
        writes: ["werkstatt.identity.json"],
        cacheable: false,
        execute: runIdentityBootstrap,
      });

      registry.registerCommand({
        name: "identity.credential.issue",
        modulePath: "packages/werkstatt-engine/src/handoff/identity-module.ts",
        generates: [],
        description: "Issue a SiteOwnershipCredential or ActorDelegationCredential (RFC-0558).",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: true,
        flags: {
          type: {
            kind: "string",
            required: true,
            description: "Credential type: SiteOwnershipCredential | ActorDelegationCredential.",
          },
          subject: {
            kind: "string",
            required: true,
            description: "VC subject id (did:web:<domain>#<key>).",
          },
          site: {
            kind: "string",
            required: true,
            description: "Sternsystem id the credential is scoped to.",
          },
          scopes: {
            kind: "string",
            description: "Comma-separated scopes for ActorDelegationCredential.",
          },
          "expires-at": {
            kind: "string",
            description: "ISO-8601 expiry for ActorDelegationCredential.",
          },
        },
        writes: ["werkstatt.identity.json"],
        reads: ["werkstatt.identity.json"],
        cacheable: false,
        execute: runIdentityCredentialIssue,
      });

      registry.registerCommand({
        name: "identity.credential.verify",
        modulePath: "packages/werkstatt-engine/src/handoff/identity-module.ts",
        description: "Verify a credential's signature, revocation status, and expiry (RFC-0558).",
        scope: "workspace",
        supportsAllSites: false,
        flags: {
          "credential-id": {
            kind: "string",
            required: true,
            description: "Credential id to verify.",
          },
        },
        reads: ["werkstatt.identity.json"],
        cacheable: false,
        execute: runIdentityCredentialVerify,
      });

      registry.registerCommand({
        name: "identity.credential.revoke",
        modulePath: "packages/werkstatt-engine/src/handoff/identity-module.ts",
        generates: [],
        description: "Revoke a credential by adding it to the revocation list (RFC-0558).",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: true,
        flags: {
          "credential-id": {
            kind: "string",
            required: true,
            description: "Credential id to revoke.",
          },
        },
        writes: ["werkstatt.identity.json"],
        reads: ["werkstatt.identity.json"],
        cacheable: false,
        execute: runIdentityCredentialRevoke,
      });
    },
  };
}
