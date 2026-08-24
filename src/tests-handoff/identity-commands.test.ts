/*
<MODULE_CONTRACT>
  <purpose>RFC-0558: unit tests for identity command handlers.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0558: initial identity command handler tests.</item>
</CHANGE_SUMMARY>
*/

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";
import { runIdentityBootstrap } from "../identity/identity-bootstrap.ts";
import { runIdentityCredentialIssue } from "../identity/identity-credential-issue.ts";
import { runIdentityCredentialVerify } from "../identity/identity-credential-verify.ts";
import { runIdentityCredentialRevoke } from "../identity/identity-credential-revoke.ts";
import { readIdentityConfig } from "../identity/identity-io.ts";
import { expectData } from "./helpers/kernel-result-helpers.ts";

function makeInput(flags: Record<string, string | boolean>): KernelCommandInput {
  return { flags } as KernelCommandInput;
}

function makeContext(workspaceRoot: string): KernelRuntimeContext {
  return { workspaceRoot } as KernelRuntimeContext;
}

describe("identity commands", () => {
  let tempDir: string;
  let privateKeyHex: string;

  afterEach(async () => {
    delete process.env["PASSPORT_SIGNING_KEY"];
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  describe("identity.bootstrap", () => {
    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), "identity-test-"));
    });

    it("creates werkstatt.identity.json with self-ownership VC", async () => {
      const result = await runIdentityBootstrap(
        makeInput({ "operator-name": "Test Operator", domain: "warpgogol.com" }),
        makeContext(tempDir),
      );

      expect(result.exitCode).toBe(0);
      expect(expectData(result).operatorName).toBe("Test Operator");
      expect(expectData(result).domain).toBe("warpgogol.com");
      expect(expectData(result).authMode).toBe("permissive");
      expect(expectData(result).selfOwnershipCredentialId).toBeTruthy();
      expect(expectData(result).privateKeyHex).toBeTruthy();

      privateKeyHex = expectData(result).privateKeyHex;
      process.env["PASSPORT_SIGNING_KEY"] = privateKeyHex;

      const config = await readIdentityConfig(tempDir);
      expect(config.schemaVersion).toBe("1.0");
      expect(config.operatorName).toBe("Test Operator");
      expect(config.authMode).toBe("permissive");
      expect(config.issuedCredentials).toHaveLength(1);
      expect(config.issuedCredentials[0]!.type).toBe("SiteOwnershipCredential");
      expect(config.revokedCredentialIds).toEqual([]);
    });
  });

  describe("identity.credential.issue + verify + revoke", () => {
    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), "identity-test-"));

      const bootstrapResult = await runIdentityBootstrap(
        makeInput({ "operator-name": "Test Operator", domain: "warpgogol.com" }),
        makeContext(tempDir),
      );
      privateKeyHex = expectData(bootstrapResult).privateKeyHex;
      process.env["PASSPORT_SIGNING_KEY"] = privateKeyHex;
    });

    it("issues and verifies an ActorDelegationCredential", async () => {
      const issueResult = await runIdentityCredentialIssue(
        makeInput({
          type: "ActorDelegationCredential",
          subject: "did:web:warpgogol.com#agent-v1",
          site: "warpgogol-com",
          scopes: "mission.open,workpiece.write",
          "expires-at": "2099-01-01T00:00:00.000Z",
        }),
        makeContext(tempDir),
      );

      expect(issueResult.exitCode).toBe(0);
      expect(expectData(issueResult).type).toBe("ActorDelegationCredential");

      const verifyResult = await runIdentityCredentialVerify(
        makeInput({ "credential-id": expectData(issueResult).credentialId }),
        makeContext(tempDir),
      );

      expect(expectData(verifyResult).valid).toBe(true);
    });

    it("revokes a credential", async () => {
      const issueResult = await runIdentityCredentialIssue(
        makeInput({
          type: "ActorDelegationCredential",
          subject: "did:web:warpgogol.com#agent-v1",
          site: "warpgogol-com",
          scopes: "*",
          "expires-at": "2099-01-01T00:00:00.000Z",
        }),
        makeContext(tempDir),
      );

      const revokeResult = await runIdentityCredentialRevoke(
        makeInput({ "credential-id": expectData(issueResult).credentialId }),
        makeContext(tempDir),
      );

      expect(expectData(revokeResult).revoked).toBe(true);

      const verifyResult = await runIdentityCredentialVerify(
        makeInput({ "credential-id": expectData(issueResult).credentialId }),
        makeContext(tempDir),
      );

      expect(expectData(verifyResult).valid).toBe(false);
      expect(expectData(verifyResult).error).toBe("revoked");
    });

    it("detects expired credentials", async () => {
      const issueResult = await runIdentityCredentialIssue(
        makeInput({
          type: "ActorDelegationCredential",
          subject: "did:web:warpgogol.com#agent-v1",
          site: "warpgogol-com",
          scopes: "*",
          "expires-at": "2000-01-01T00:00:00.000Z",
        }),
        makeContext(tempDir),
      );

      const verifyResult = await runIdentityCredentialVerify(
        makeInput({ "credential-id": expectData(issueResult).credentialId }),
        makeContext(tempDir),
      );

      expect(expectData(verifyResult).valid).toBe(false);
      expect(expectData(verifyResult).error).toBe("expired");
    });

    it("returns not-found for unknown credential id", async () => {
      const verifyResult = await runIdentityCredentialVerify(
        makeInput({ "credential-id": "urn:warpgogol:cred:nonexistent" }),
        makeContext(tempDir),
      );

      expect(expectData(verifyResult).valid).toBe(false);
      expect(expectData(verifyResult).error).toBe("not-found");
    });
  });
});
