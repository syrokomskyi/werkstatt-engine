/*
<MODULE_CONTRACT>
<purpose>ADR-0094: sternsystem.passport.verify drift-tolerance tests —
verify must agree with sternsystem.validate PASSPORT-03 on bordbuchHead
staleness: bookkeeping-only drift and post-handover head drift are tolerated;
any other entry appended after the recorded head fails verify.</purpose>
<keywords>ADR-0094, passport, verify, staleness, handover, bordbuch</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>ADR-0094: initial verify drift-tolerance tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, describe, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";
import { createDefaultIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";
import { generateKeyPair, toHex } from "@warpgogol/werkstatt-engine/signing";
import {
  buildPassportPayload,
  signPassport,
  type SignedSitePassport,
} from "./passport.ts";
import { writePassport } from "./registry-io.ts";
import { appendBordbuchEntry } from "../bordbuch/bordbuch-io.ts";
import { runSternsystemPassportVerify } from "./sternsystem-passport-verify.ts";

let tmpDir: string;
let werkstattRoot: string;
const systemId = "acme";

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "passport-verify-drift-"));
  werkstattRoot = join(tmpDir, "werkstatt");
  mkdirSync(werkstattRoot, { recursive: true });
  setupSystem();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function setupSystem(): void {
  const cacheDir = join(tmpDir, "systems-cache", systemId);
  mkdirSync(join(cacheDir, "missions"), { recursive: true });
  mkdirSync(join(cacheDir, "bordbuch"), { recursive: true });

  writeFileSync(
    join(cacheDir, "system-config.yaml"),
    [
      `schemaVersion: system-config/v1`,
      `id: ${systemId}`,
      `cosmicStar: Vega`,
      `mirrors:`,
      `  - path: ../systems-cache/${systemId}`,
      `    storageType: non-bare`,
      `  - path: ../systems-git/${systemId}.git`,
      `    storageType: bare`,
      `pinnedPlatform: 6.0.0`,
      `status: active`,
      `registeredAt: "2026-01-01T00:00:00Z"`,
      `notes: ""`,
      ``,
    ].join("\n"),
  );
}

function makeInput(flags: Record<string, unknown>): KernelCommandInput {
  return {
    flags: flags as Record<string, import("@warpgogol/werkstatt-engine/kernel").KernelFlagValue>,
    argv: [],
  };
}

function makeContext(root: string): KernelRuntimeContext {
  return {
    io: createDefaultIO().io,
    workspaceRoot: root,
    logger: {
      section: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      success: () => {},
    },
    dryRun: false,
  } as unknown as KernelRuntimeContext;
}

async function append(kind: "operator-note" | "mirror-sync" | "handover") {
  return appendBordbuchEntry(werkstattRoot, systemId, kind, `test ${kind}`, "test");
}

/** Build a payload with the current bordbuch head, sign it, write passport.json. */
async function issuePassport(): Promise<SignedSitePassport> {
  const keyPair = await generateKeyPair();
  const payload = await buildPassportPayload({
    systemId,
    werkstattRoot,
    creatorIdentity: "human:operator",
    creatorPublicKey: toHex(keyPair.publicKey),
  });
  const { passportHash, signature } = await signPassport(payload, keyPair.privateKey);
  const passport: SignedSitePassport = { payload, passportHash, signature };
  await writePassport(werkstattRoot, systemId, passport);
  return passport;
}

async function verify() {
  return runSternsystemPassportVerify(
    makeInput({ id: systemId }),
    makeContext(werkstattRoot),
  );
}

describe("ADR-0094: passport.verify bordbuchHead drift tolerance", () => {
  test("mirror-sync appended after passport → tolerated (bookkeeping-only)", async () => {
    await append("operator-note");
    await issuePassport();
    await append("mirror-sync");

    const result = await verify();
    expect(result.data!.staleness.bordbuchHeadMatches).toBe(true);
    expect(result.data!.valid).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  test("handover appended after passport → tolerated (post-handover)", async () => {
    await append("operator-note");
    await issuePassport();
    await append("handover");

    const result = await verify();
    expect(result.data!.staleness.bordbuchHeadMatches).toBe(true);
    expect(result.data!.valid).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  test("handover followed by mirror-sync → still tolerated (trailing bookkeeping stripped)", async () => {
    await append("operator-note");
    await issuePassport();
    await append("handover");
    await append("mirror-sync");

    const result = await verify();
    expect(result.data!.staleness.bordbuchHeadMatches).toBe(true);
    expect(result.data!.valid).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  test("state-changing entry appended after passport → verify fails", async () => {
    await append("operator-note");
    await issuePassport();
    await append("operator-note");

    const result = await verify();
    expect(result.data!.staleness.bordbuchHeadMatches).toBe(false);
    expect(result.data!.valid).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  test("handover followed by a state-changing entry → verify fails", async () => {
    await append("operator-note");
    await issuePassport();
    await append("handover");
    await append("operator-note");

    const result = await verify();
    expect(result.data!.staleness.bordbuchHeadMatches).toBe(false);
    expect(result.data!.valid).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  test("no drift → verify passes", async () => {
    await append("operator-note");
    await issuePassport();

    const result = await verify();
    expect(result.data!.staleness.bordbuchHeadMatches).toBe(true);
    expect(result.data!.valid).toBe(true);
    expect(result.exitCode).toBe(0);
  });
});
