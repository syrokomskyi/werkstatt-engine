/*
<MODULE_CONTRACT>
<purpose>RFC-0966: sternsystem.passport.generate — build, sign, and write the
site passport for a Sternsystem. Reads system-config.yaml, system.pin.json,
.env.example, bordbuch, and mission count to assemble SitePassportV1, then
signs with the creator's Ed25519 key (SIGNING_PRIVATE_KEY env var).</purpose>
<non-goals>
  <item>Does not verify the passport — use sternsystem.passport.verify for that.</item>
  <item>Does not manage key rotation — see RFC-0966 Key rotation section.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0966: initial passport generate command handler.</item>
</CHANGE_SUMMARY>
*/

import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { loadPrivateKey } from "@warpgogol/werkstatt-engine/signing";
import { resolveActor } from "../mission/actor-identity.ts";
import {
  buildPassportPayload,
  signPassport,
  derivePublicKey,
  type SignedSitePassport,
} from "./passport.ts";
import {
  readPassport,
  writePassport,
  readSystemState,
  writeSystemState,
} from "./registry-io.ts";

export interface SternsystemPassportGenerateData {
  command: "sternsystem.passport.generate";
  systemId: string;
  passportHash: string;
  passportPath: string;
  creator: string;
  generated: boolean;
}

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

function filterEnv(env: Record<string, string | undefined>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

export async function runSternsystemPassportGenerate(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<SternsystemPassportGenerateData>> {
  const { workspaceRoot, logger } = context;
  const systemId = flagString(input, "id");

  if (!systemId) {
    throw new Error("[sternsystem.passport.generate] requires --id <systemId>");
  }

  const creatorIdentity = resolveActor(input);

  const env = { ...filterEnv(process.env) };
  const privateKeyEnv = env["SIGNING_PRIVATE_KEY"];
  const privateKeyPath = env["SIGNING_PRIVATE_KEY_PATH"];

  if (!privateKeyEnv && !privateKeyPath) {
    throw new Error(
      "[sternsystem.passport.generate] No signing key configured. Set SIGNING_PRIVATE_KEY or SIGNING_PRIVATE_KEY_PATH env var.",
    );
  }

  let privateKeyBytes: Uint8Array;
  try {
    if (privateKeyEnv) {
      privateKeyBytes = await loadPrivateKey({ pem: privateKeyEnv });
    } else {
      privateKeyBytes = await loadPrivateKey({ filePath: privateKeyPath!, encoding: "pem" });
    }
  } catch (err) {
    throw new Error(
      `[sternsystem.passport.generate] Failed to load private key: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const creatorPublicKey = await derivePublicKey(privateKeyBytes);

  const existingPassport = await readPassport(workspaceRoot, systemId);
  let createdAt = new Date().toISOString();
  if (existingPassport) {
    createdAt = existingPassport.payload.provenance.createdAt;
  }

  const payload = await buildPassportPayload({
    systemId,
    werkstattRoot: workspaceRoot,
    creatorIdentity,
    creatorPublicKey,
  });

  payload.provenance.createdAt = createdAt;

  const { passportHash, signature } = await signPassport(payload, privateKeyBytes);

  const doc: SignedSitePassport = {
    payload,
    passportHash,
    signature,
  };

  const existingHash = existingPassport?.passportHash;
  if (existingHash === passportHash) {
    logger.info(
      `[sternsystem.passport.generate] ${systemId} passport unchanged (hash: ${passportHash}) — no write needed`,
    );
    const passportPath = `../systems-cache/${systemId}/passport.json`;
    return {
      data: {
        command: "sternsystem.passport.generate",
        systemId,
        passportHash,
        passportPath,
        creator: creatorIdentity,
        generated: false,
      },
      summary: `[sternsystem.passport.generate] ${systemId} passport unchanged — skipped (DNA-58 byte-stability)`,
    };
  }

  const passportPath = await writePassport(workspaceRoot, systemId, doc);

  try {
    const state = await readSystemState(workspaceRoot, systemId);
    if (!state.passportRequired) {
      state.passportRequired = true;
      await writeSystemState(workspaceRoot, systemId, state);
      logger.info(`  Set passportRequired: true in system-state.yaml`);
    }
  } catch {
    // Non-fatal — state update skipped
  }

  logger.success(
    `[sternsystem.passport.generate] ${systemId} passport generated (hash: ${passportHash})`,
  );

  return {
    data: {
      command: "sternsystem.passport.generate",
      systemId,
      passportHash,
      passportPath,
      creator: creatorIdentity,
      generated: true,
    },
    summary: `[sternsystem.passport.generate] ${systemId} passport signed by ${creatorIdentity}`,
  };
}
