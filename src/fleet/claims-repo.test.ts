/*
<MODULE_CONTRACT>
<purpose>RFC-1124: tests for the git-native fleet claims registry — publish,
offline verify (self/transfer legitimacy), LWW conflict resolution, tombstone
stale verdict, sync divergence diagnostics.</purpose>
<non-goals>
  <item>No network — remotes are local bare repos in tmp dirs.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1124: initial coverage for claims-repo.ts (AC-1, AC-4, AC-6, AC-8, AC-9).</item>
</CHANGE_SUMMARY>
*/

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { generateKeyPair, toHex } from "@warpgogol/werkstatt-engine/signing";
import type { FleetClaim } from "@warpgogol/werkstatt-shared/passport/claim-sign";
import { appendBordbuchEntry } from "../bordbuch/bordbuch-io.ts";
import {
  buildClaim,
  claimsStatus,
  loadFleetClaimsConfig,
  publishClaim,
  publishPendingTransferClaim,
  resolveClaimConflict,
  syncClaims,
  verifyClaimOffline,
} from "./claims-repo.ts";
import { deriveInstanceId } from "./ownership-registry.ts";

let root: string;
let systemId: string;

beforeEach(() => {
  // werkstatt root nested inside the tmpdir — resolveCacheClonePath resolves
  // systems-cache as a SIBLING of the werkstatt root, so this keeps the cache
  // inside the per-test tmpdir instead of leaking into shared /tmp.
  root = join(mkdtempSync(join(tmpdir(), "claims-repo-")), "werkstatt");
  mkdirSync(root, { recursive: true });
  systemId = "test-site.example";
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function makeKey() {
  const kp = await generateKeyPair();
  return { privateKeyHex: toHex(kp.privateKey), publicKeyHex: toHex(kp.publicKey) };
}

function writePassportFixture(
  system: string,
  publicKeyHex: string,
  passportHash: string,
  identity = "did:web:creator",
): void {
  const cacheDir = join(root, "..", "systems-cache", system);
  mkdirSync(join(cacheDir, "bordbuch"), { recursive: true });
  const passport = {
    passportHash,
    payload: {
      creator: { identity, publicKey: publicKeyHex },
      provenance: { bordbuchHead: null },
    },
  };
  writeFileSync(join(cacheDir, "passport.json"), JSON.stringify(passport, null, 2));
}

async function writeFleetConfig(remotes: string[] = []): Promise<void> {
  await writeFile(
    join(root, "werkstatt.fleet.json"),
    JSON.stringify({ remotes, localPath: ".werkstatt/fleet-claims" }, null, 2),
  );
}

function readLocalClaim(system: string): FleetClaim | null {
  const p = join(root, ".werkstatt/fleet-claims/claims", `${system}.json`);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as FleetClaim;
}

function writeLocalClaim(system: string, claim: FleetClaim): void {
  const dir = join(root, ".werkstatt/fleet-claims/claims");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${system}.json`), JSON.stringify(claim, null, 2));
}

function makeBareRemote(name: string): string {
  const remotePath = join(root, name);
  mkdirSync(remotePath, { recursive: true });
  execFileSync("git", ["-C", remotePath, "init", "--bare", "--initial-branch=main"], {
    stdio: "pipe",
  });
  return remotePath;
}

// ---------------------------------------------------------------------------
// AC-1: publish writes a signed claim verifiable against signerPublicKey
// ---------------------------------------------------------------------------

describe("RFC-1124 AC-1: publishClaim", () => {
  it("writes claims/<id>.json whose signature verifies against embedded signerPublicKey", async () => {
    const key = await makeKey();
    writePassportFixture(systemId, key.publicKeyHex, "p".repeat(64));
    await writeFleetConfig();

    const result = await publishClaim({
      systemId,
      werkstattRoot: root,
      signerPrivateKeyHex: key.privateKeyHex,
      signerPublicKey: key.publicKeyHex,
      push: false,
    });

    const claim = readLocalClaim(systemId);
    expect(claim, "claim file must exist after publish").not.toBeNull();
    expect(claim!.passportHash).toBe("p".repeat(64));
    expect(claim!.signerPublicKey).toBe(key.publicKeyHex);
    expect(claim!.instanceId).toBe(deriveInstanceId(key.publicKeyHex));
    expect(result.commit).toMatch(/^[0-9a-f]{40}$/);

    const { verifyClaim } = await import("@warpgogol/werkstatt-shared/passport/claim-sign");
    expect(await verifyClaim(claim!), "signature must verify against signerPublicKey").toBe(true);
  });

  it("verify resolves the published claim as valid offline", async () => {
    const key = await makeKey();
    writePassportFixture(systemId, key.publicKeyHex, "q".repeat(64));
    await writeFleetConfig();
    await publishClaim({
      systemId,
      werkstattRoot: root,
      signerPrivateKeyHex: key.privateKeyHex,
      signerPublicKey: key.publicKeyHex,
      push: false,
    });

    const result = await verifyClaimOffline({ systemId, werkstattRoot: root });
    expect(result.verdict).toBe("valid");
    expect(result.claim?.passportHash).toBe("q".repeat(64));
  });
});

// ---------------------------------------------------------------------------
// AC-4 + AC-8: invalid signature → invalid-signature, existing claim untouched
// ---------------------------------------------------------------------------

describe("RFC-1124 AC-4/AC-8: invalid signature handling", () => {
  it("reports invalid-signature and leaves the file untouched", async () => {
    const key = await makeKey();
    writePassportFixture(systemId, key.publicKeyHex, "r".repeat(64));
    await writeFleetConfig();
    await publishClaim({
      systemId,
      werkstattRoot: root,
      signerPrivateKeyHex: key.privateKeyHex,
      signerPublicKey: key.publicKeyHex,
      push: false,
    });

    // Corrupt the signature in place.
    const claim = readLocalClaim(systemId)!;
    const corrupted = { ...claim, signature: "z" + "1".repeat(87) };
    writeLocalClaim(systemId, corrupted);
    const before = readFileSync(
      join(root, ".werkstatt/fleet-claims/claims", `${systemId}.json`),
      "utf8",
    );

    const result = await verifyClaimOffline({ systemId, werkstattRoot: root });
    expect(result.verdict).toBe("invalid-signature");

    const after = readFileSync(
      join(root, ".werkstatt/fleet-claims/claims", `${systemId}.json`),
      "utf8",
    );
    expect(after, "verify must never write — corrupted claim stays as evidence").toBe(before);
  });
});

// ---------------------------------------------------------------------------
// AC-6: fully offline verify (remote configured but unreachable)
// ---------------------------------------------------------------------------

describe("RFC-1124 AC-6: offline verify", () => {
  it("resolves verdict without touching remotes", async () => {
    const key = await makeKey();
    writePassportFixture(systemId, key.publicKeyHex, "s".repeat(64));
    // Remote points at a nonexistent path — any fetch would fail loudly.
    await writeFleetConfig(["/nonexistent/remote.git"]);
    await publishClaim({
      systemId,
      werkstattRoot: root,
      signerPrivateKeyHex: key.privateKeyHex,
      signerPublicKey: key.publicKeyHex,
      push: false,
    });

    const result = await verifyClaimOffline({ systemId, werkstattRoot: root });
    expect(result.verdict).toBe("valid");
  });

  it("reports no-claim for unknown systems", async () => {
    await writeFleetConfig();
    const result = await verifyClaimOffline({ systemId: "ghost.example", werkstattRoot: root });
    expect(result.verdict).toBe("no-claim");
    expect(result.claim).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC-9: transfer claim legitimacy via bordbuch handover event
// ---------------------------------------------------------------------------

describe("RFC-1124 AC-9: transfer claim legitimacy", () => {
  it("accepts a transfer claim signed by the previous creator with matching bordbuch event", async () => {
    const oldKey = await makeKey();
    const newKey = await makeKey();
    const oldHash = "a".repeat(64);
    const newHash = "b".repeat(64);
    const authHash = "c".repeat(64);

    // Old owner's self-claim exists first.
    writePassportFixture(systemId, oldKey.publicKeyHex, oldHash);
    await writeFleetConfig();
    await publishClaim({
      systemId,
      werkstattRoot: root,
      signerPrivateKeyHex: oldKey.privateKeyHex,
      signerPublicKey: oldKey.publicKeyHex,
      push: false,
    });

    // Handover: new passport + bordbuch handover event.
    writePassportFixture(systemId, newKey.publicKeyHex, newHash, "did:web:new-creator");
    await appendBordbuchEntry(
      root,
      systemId,
      "handover",
      "handover to new creator",
      "did:web:new-creator",
      {
        missionId: null,
        releaseId: null,
        metadata: { authorizationHash: authHash, newPassportHash: newHash },
      },
    );

    // Sender (old key) publishes the transfer claim.
    const transfer = await publishPendingTransferClaim({
      systemId,
      werkstattRoot: root,
      signerPrivateKeyHex: oldKey.privateKeyHex,
      signerPublicKey: oldKey.publicKeyHex,
      push: false,
    });
    expect(transfer, "pending transfer claim must be detected and published").not.toBeNull();
    expect(transfer!.claim.signerPublicKey).toBe(oldKey.publicKeyHex);
    expect(transfer!.claim.instanceId).toBe(deriveInstanceId(newKey.publicKeyHex));
    expect(transfer!.claim.authorizationHash).toBe(authHash);

    const result = await verifyClaimOffline({ systemId, werkstattRoot: root });
    expect(result.verdict).toBe("valid");
    expect(result.claim?.passportHash).toBe(newHash);
  });

  it("rejects a transfer claim without a matching bordbuch handover event", async () => {
    const oldKey = await makeKey();
    const newKey = await makeKey();
    writePassportFixture(systemId, oldKey.publicKeyHex, "a".repeat(64));
    await writeFleetConfig();
    await publishClaim({
      systemId,
      werkstattRoot: root,
      signerPrivateKeyHex: oldKey.privateKeyHex,
      signerPublicKey: oldKey.publicKeyHex,
      push: false,
    });

    // Forge a transfer claim: describes new owner, signed by old key, but NO
    // bordbuch handover event exists.
    writePassportFixture(systemId, newKey.publicKeyHex, "b".repeat(64), "did:web:attacker");
    const forged = await buildClaim({
      systemId,
      werkstattRoot: root,
      signerPrivateKeyHex: oldKey.privateKeyHex,
      signerPublicKey: oldKey.publicKeyHex,
      authorizationHash: "f".repeat(64),
    });
    writeLocalClaim(systemId, forged);

    const result = await verifyClaimOffline({ systemId, werkstattRoot: root });
    expect(result.verdict).toBe("invalid-signature");
  });
});

// ---------------------------------------------------------------------------
// Tombstone + LWW
// ---------------------------------------------------------------------------

describe("RFC-1124: tombstone and conflict resolution", () => {
  it("reports stale for a tombstone claim (supersededBy set)", async () => {
    const key = await makeKey();
    writePassportFixture(systemId, key.publicKeyHex, "t".repeat(64));
    await writeFleetConfig();
    await publishClaim({
      systemId,
      werkstattRoot: root,
      signerPrivateKeyHex: key.privateKeyHex,
      signerPublicKey: key.publicKeyHex,
      push: false,
    });
    // A tombstone must be SIGNED — mutating supersededBy on the existing claim
    // would invalidate the signature (correctly yielding invalid-signature).
    const claim = readLocalClaim(systemId)!;
    const { signClaim } = await import("@warpgogol/werkstatt-shared/passport/claim-sign");
    const { signature: _signature, ...data } = claim;
    const tombstone: FleetClaim = {
      ...data,
      supersededBy: "u".repeat(64),
      signature: await signClaim({ ...data, supersededBy: "u".repeat(64) }, key.privateKeyHex),
    };
    writeLocalClaim(systemId, tombstone);

    const result = await verifyClaimOffline({ systemId, werkstattRoot: root });
    expect(result.verdict).toBe("stale");
  });

  it("resolveClaimConflict: newer claimedAt wins; equal → self-claim beats transfer", async () => {
    const selfClaim = {
      claimedAt: "2026-01-01T00:00:00Z",
      signerPublicKey: "aa",
      instanceId: deriveInstanceId("aa"),
    } as FleetClaim;
    const newerTransfer = {
      claimedAt: "2026-01-02T00:00:00Z",
      signerPublicKey: "bb",
      instanceId: deriveInstanceId("cc"),
    } as FleetClaim;
    expect(resolveClaimConflict(selfClaim, newerTransfer).winner).toBe(newerTransfer);

    const sameTimeTransfer = { ...newerTransfer, claimedAt: selfClaim.claimedAt };
    expect(resolveClaimConflict(selfClaim, sameTimeTransfer).winner).toBe(selfClaim);
  });
});

// ---------------------------------------------------------------------------
// Sync + status
// ---------------------------------------------------------------------------

describe("RFC-1124: sync and status", () => {
  it("pushes committed claims to a local bare remote", async () => {
    const key = await makeKey();
    const remote = makeBareRemote("claims-remote.git");
    writePassportFixture(systemId, key.publicKeyHex, "v".repeat(64));
    await writeFleetConfig([remote]);
    const pub = await publishClaim({
      systemId,
      werkstattRoot: root,
      signerPrivateKeyHex: key.privateKeyHex,
      signerPublicKey: key.publicKeyHex,
    });
    expect(pub.pushed).toBe(true);

    const remoteHas = execFileSync("git", ["-C", remote, "show", `main:claims/${systemId}.json`], {
      encoding: "utf8",
    });
    expect(JSON.parse(remoteHas).passportHash).toBe("v".repeat(64));
  });

  it("status reports claims count and unpushed commits", async () => {
    const key = await makeKey();
    writePassportFixture(systemId, key.publicKeyHex, "w".repeat(64));
    await writeFleetConfig();
    await publishClaim({
      systemId,
      werkstattRoot: root,
      signerPrivateKeyHex: key.privateKeyHex,
      signerPublicKey: key.publicKeyHex,
      push: false,
    });

    const status = await claimsStatus(root);
    expect(status.configured).toBe(true);
    expect(status.claims).toBe(1);
    expect(status.unpushedCommits).toBeGreaterThan(0);
  });

  it("sync fast-forwards a remote claim into the local clone", async () => {
    const key = await makeKey();
    const remote = makeBareRemote("claims-remote2.git");
    writePassportFixture(systemId, key.publicKeyHex, "x".repeat(64));
    await writeFleetConfig([remote]);
    await publishClaim({
      systemId,
      werkstattRoot: root,
      signerPrivateKeyHex: key.privateKeyHex,
      signerPublicKey: key.publicKeyHex,
    });

    // Second workshop clones the same remote and adds another system's claim.
    const other = mkdtempSync(join(tmpdir(), "claims-other-"));
    try {
      execFileSync("git", ["clone", remote, join(other, "clone")], { stdio: "pipe" });
      const otherClaim = { ...readLocalClaim(systemId)!, systemId: "other-site.example" };
      const dir = join(other, "clone/claims");
      writeFileSync(join(dir, "other-site.example.json"), JSON.stringify(otherClaim, null, 2));
      execFileSync("git", ["-C", join(other, "clone"), "add", "claims/other-site.example.json"], {
        stdio: "pipe",
      });
      execFileSync(
        "git",
        [
          "-C",
          join(other, "clone"),
          "-c",
          "user.name=t",
          "-c",
          "user.email=t@t",
          "commit",
          "-m",
          "other claim",
        ],
        { stdio: "pipe" },
      );
      execFileSync("git", ["-C", join(other, "clone"), "push", "origin", "HEAD:main"], {
        stdio: "pipe",
      });

      const sync = await syncClaims(root);
      expect(sync.fastForwarded).toBe(true);
      expect(sync.diverged).toHaveLength(0);
      expect(existsSync(join(root, ".werkstatt/fleet-claims/claims/other-site.example.json"))).toBe(
        true,
      );
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

describe("RFC-1124: config", () => {
  it("loadFleetClaimsConfig returns null without werkstatt.fleet.json", async () => {
    expect(await loadFleetClaimsConfig(root)).toBeNull();
  });
});
