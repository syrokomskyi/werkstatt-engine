/*
<MODULE_CONTRACT>
  <purpose>RFC-0558: identity kernel module — registers identity.bootstrap,
  identity.credential.issue, identity.credential.verify, identity.credential.revoke
  commands for VC-based actor identity and site ownership.</purpose>
  <non-goals>
    <item>Do not register mission, sternsystem, or handoff commands — those have their own modules.</item>
    <item>Do not handle key storage — private keys arrive via WERKSTATT_OPERATOR_SIGNING_KEY env var.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0558: initial identity module with 4 commands.</item>
  <item>RFC-1173: declare mutatesState on all kernel commands — collectDeclarationDiagnostics emits error-severity MUTATES-STATE-DECLARED, command.manifest.validate is the blocking consumer in packages.check, sweep declares the flag on every command definition (factories hardcode false for read-only check specs)</item>
  <item>RFC-1231: step 1 — rename supportsAllSites to acceptsAllFlag

Mechanical sweep: the field only ever gated --all argv acceptance; fan-out
follows the parsed selector. Guard renamed assertAllSitesAllowed ->
assertAllFlagAccepted, message updated. 417 declaration sites + type
surfaces (KernelCommandMetadata, ForgeCommandMetadata) in one atomic pass.</item>
</CHANGE_SUMMARY>
*/

import type { ModuleExport } from "@warpgogol/werkstatt-shared/kernel";

export async function createIdentityModule(): Promise<ModuleExport> {
  const { runIdentityBootstrap } = await import("../identity/identity-bootstrap.ts");
  const { runIdentityCredentialIssue } = await import("../identity/identity-credential-issue.ts");
  const { runIdentityCredentialVerify } = await import("../identity/identity-credential-verify.ts");
  const { runIdentityCredentialRevoke } = await import("../identity/identity-credential-revoke.ts");
  return {
    name: "identity",
    version: "0.1.0",
    declarations: [],
    commands: [
      {
        name: "identity.bootstrap",
        modulePath: "packages/werkstatt-engine/src/handoff/identity-module.ts",
        generates: [],
        description:
          "Generate operator keypair, write werkstatt.identity.json, issue self-ownership VC (RFC-0558). Required flags: `--operator-name`, `--domain`.",
        scope: "workspace",
        acceptsAllFlag: false,
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
      },
      {
        name: "identity.credential.issue",
        coverage: "operator" as const,
        modulePath: "packages/werkstatt-engine/src/handoff/identity-module.ts",
        generates: [],
        description:
          "Issue a SiteOwnershipCredential or ActorDelegationCredential (RFC-0558). Required flags: `--type`, `--subject`, `--site`.",
        scope: "workspace",
        acceptsAllFlag: false,
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
      },
      {
        name: "identity.credential.verify",
        coverage: "operator" as const,
        coverageNote: "requires --credential-id",
        mutatesState: false,
        modulePath: "packages/werkstatt-engine/src/handoff/identity-module.ts",
        description:
          "Verify a credential's signature, revocation status, and expiry (RFC-0558). Required flags: `--credential-id`.",
        scope: "workspace",
        acceptsAllFlag: false,
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
      },
      {
        name: "identity.credential.revoke",
        coverage: "operator" as const,
        modulePath: "packages/werkstatt-engine/src/handoff/identity-module.ts",
        generates: [],
        description:
          "Revoke a credential by adding it to the revocation list (RFC-0558). Required flags: `--credential-id`.",
        scope: "workspace",
        acceptsAllFlag: false,
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
      },
    ],
    pipelines: [],
  };
}
