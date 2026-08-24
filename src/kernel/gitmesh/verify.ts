/*
<MODULE_CONTRACT>
<purpose>
RFC-0563: gitmesh.verify command handler. Verifies commit signatures in the
local clone against the operator's public key from werkstatt.identity.json.
Implements incremental verification — only new commits since the last
verification are checked. Does not abort on first invalid signature; reports
all invalid signatures in one pass.
</purpose>
<non-goals>
  <item>Do not implement signature creation — that is RFC-0560.</item>
  <item>Do not implement key rotation — that is a future RFC-0558 extension.</item>
  <item>Do not perform network I/O — this is a local-only verification.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0563: initial implementation — gitmesh.verify handler with incremental verification.</item>
  <item>RFC-0563 fix: add diagnostics arrays (RFC-0086), document deferred RFC-0560 key comparison dependency.</item>
</CHANGE_SUMMARY>
*/

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { KernelCommandInput, KernelCommandResult, KernelRuntimeContext } from "../types.ts";
import type { GitMeshVerifyResult } from "./types.ts";
import { loadGitMeshConfig } from "./config.ts";
import { gitLogSignatureStatus, gitRevParseHead } from "./git-ops.ts";

const LAST_VERIFIED_FILE = ".git/gitmesh.last-verified";
const IDENTITY_FILENAME = "werkstatt.identity.json";

interface IdentityFile {
  publicKey?: string;
  publicKeys?: string[];
}

async function loadIdentityPublicKeys(workspaceRoot: string): Promise<string[]> {
  // RFC-0560 dependency: git's %G? signature status checks git's keyring, not the
  // operator's specific public key. The publicKeys loaded here will be used to
  // compare against signing keys once RFC-0560's trailer format is implemented.
  // Until then, gitmesh.verify relies on git's GPG/SSH signature verification.
  const identityPath = join(workspaceRoot, IDENTITY_FILENAME);
  const raw = await readFile(identityPath, "utf8");
  const identity: IdentityFile = JSON.parse(raw);

  const keys: string[] = [];
  if (typeof identity.publicKey === "string") {
    keys.push(identity.publicKey);
  }
  if (Array.isArray(identity.publicKeys)) {
    keys.push(...identity.publicKeys.filter((k): k is string => typeof k === "string"));
  }

  return keys;
}

export async function runGitMeshVerify(
  _input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<GitMeshVerifyResult>> {
  const { workspaceRoot } = context;

  // Load config
  try {
    await loadGitMeshConfig(workspaceRoot);
  } catch {
    return {
      data: {
        totalCommits: 0,
        signedCommits: 0,
        unsignedCommits: 0,
        invalidSignatures: 0,
        verified: false,
        diagnostics: ["gitmesh.verify: no werkstatt.gitmesh.json found — run gitmesh.sync first"],
      },
      exitCode: 1,
      summary: "[gitmesh.verify] no werkstatt.gitmesh.json found — run gitmesh.sync first",
      nextSteps: [
        {
          action: "Run gitmesh.sync first to configure gitmesh, then re-run gitmesh.verify",
          kind: "required",
        },
      ],
    };
  }

  // Load identity
  let publicKeys: string[];
  try {
    publicKeys = await loadIdentityPublicKeys(workspaceRoot);
  } catch {
    return {
      data: {
        totalCommits: 0,
        signedCommits: 0,
        unsignedCommits: 0,
        invalidSignatures: 0,
        verified: false,
        diagnostics: [
          `gitmesh.verify: no ${IDENTITY_FILENAME} found — cannot verify signatures without operator public key`,
        ],
      },
      exitCode: 1,
      summary: `[gitmesh.verify] no ${IDENTITY_FILENAME} found — cannot verify signatures without operator public key`,
      nextSteps: [
        {
          action: "Run identity.bootstrap first (RFC-0558), then re-run gitmesh.verify",
          kind: "required",
        },
      ],
    };
  }

  if (publicKeys.length === 0) {
    return {
      data: {
        totalCommits: 0,
        signedCommits: 0,
        unsignedCommits: 0,
        invalidSignatures: 0,
        verified: false,
        diagnostics: [`gitmesh.verify: ${IDENTITY_FILENAME} contains no public keys`],
      },
      exitCode: 1,
      summary: `[gitmesh.verify] ${IDENTITY_FILENAME} contains no public keys`,
      nextSteps: [
        {
          action: `Add public keys to ${IDENTITY_FILENAME}, then re-run gitmesh.verify`,
          kind: "required",
        },
      ],
    };
  }

  const headSha = await gitRevParseHead(workspaceRoot).catch(() => "");
  if (!headSha) {
    return {
      data: {
        totalCommits: 0,
        signedCommits: 0,
        unsignedCommits: 0,
        invalidSignatures: 0,
        verified: false,
        diagnostics: ["gitmesh.verify: cannot resolve HEAD — not a git repository?"],
      },
      exitCode: 1,
      summary: "[gitmesh.verify] cannot resolve HEAD — not a git repository?",
      nextSteps: [
        {
          action: "Ensure the workspace is a git repository, then re-run gitmesh.verify",
          kind: "required",
        },
      ],
    };
  }

  // Determine range (incremental verification)
  let range: string;
  let lastVerifiedSha = "";
  try {
    lastVerifiedSha = (await readFile(join(workspaceRoot, LAST_VERIFIED_FILE), "utf8")).trim();
    range = `${lastVerifiedSha}..${headSha}`;
  } catch {
    // Full verification — all commits
    range = "--all";
  }

  const commits = await gitLogSignatureStatus(range, workspaceRoot);

  let signedCommits = 0;
  let unsignedCommits = 0;
  let invalidSignatures = 0;

  for (const commit of commits) {
    const status = commit.signatureStatus;
    if (status === "G") {
      signedCommits++;
    } else if (status === "U" || status === "N") {
      unsignedCommits++;
    } else {
      // B (bad), X (expired), Y (key missing), E (expired key), R (revoked)
      invalidSignatures++;
    }
  }

  const totalCommits = commits.length;
  const verified = unsignedCommits === 0 && invalidSignatures === 0;

  // Write last-verified SHA
  await writeFile(join(workspaceRoot, LAST_VERIFIED_FILE), headSha, "utf8");

  const diagnostics: string[] = [];
  if (unsignedCommits > 0) {
    diagnostics.push(`gitmesh.verify: ${unsignedCommits} unsigned commit(s) found`);
  }
  if (invalidSignatures > 0) {
    diagnostics.push(`gitmesh.verify: ${invalidSignatures} invalid signature(s) found`);
  }
  if (range === "--all") {
    diagnostics.push(
      "gitmesh.verify: full verification (first run) — may be slow on large repositories",
    );
  }

  return {
    data: {
      totalCommits,
      signedCommits,
      unsignedCommits,
      invalidSignatures,
      verified,
      diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
    },
    exitCode: verified ? 0 : 1,
    summary:
      `[gitmesh.verify] ${totalCommits} commit(s) checked, ${signedCommits} signed, ${unsignedCommits} unsigned, ${invalidSignatures} invalid` +
      (lastVerifiedSha
        ? ` (incremental from ${lastVerifiedSha.slice(0, 8)})`
        : " (full verification)"),
    nextSteps: verified
      ? undefined
      : [
          {
            action: "Review the unsigned/invalid commits listed above, then re-run gitmesh.verify",
            kind: "required",
          },
        ],
  };
}
