/*
<MODULE_CONTRACT>
<purpose>RFC-0967: Command handlers for fleet.ownership.register, verify, transfer.
Thin wrappers around ownership-registry.ts client logic.</purpose>
<non-goals>
  <item>Does not implement registry logic — that lives in ownership-registry.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0967: initial command handlers for fleet.ownership.register/verify/transfer.</item>
</CHANGE_SUMMARY>
*/

import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "../kernel/types.ts";
import {
  registerOwnership,
  verifyOwnership,
  transferOwnership,
  OwnershipError,
} from "./ownership-registry.ts";

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

function flagBool(input: KernelCommandInput, key: string): boolean {
  const v = input.flags[key];
  return v === true || v === "true";
}

export async function runFleetOwnershipRegister(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult> {
  const systemId = flagString(input, "id");
  if (!systemId) {
    return {
      exitCode: 1,
      summary: "fleet.ownership.register: --id flag is required",
      data: { error: "missing --id flag" },
    };
  }

  try {
    const result = await registerOwnership({
      systemId,
      werkstattRoot: context.workspaceRoot,
    });

    if (!result.registered && result.conflict) {
      return {
        exitCode: 1,
        summary: `[fleet.ownership.register] ${systemId} conflict: already claimed by ${result.conflict.existingClaim?.instanceId ?? "unknown"}`,
        data: {
          command: "fleet.ownership.register",
          systemId,
          ...result,
        },
      };
    }

    return {
      exitCode: 0,
      summary: `[fleet.ownership.register] ${systemId} registered (hash: ${result.claim.passportHash})`,
      data: {
        command: "fleet.ownership.register",
        systemId,
        ...result,
      },
    };
  } catch (err) {
    if (err instanceof OwnershipError) {
      return {
        exitCode: 1,
        summary: `[fleet.ownership.register] ${err.code}: ${err.message}`,
        data: { command: "fleet.ownership.register", systemId, error: err.code, message: err.message },
      };
    }
    return {
      exitCode: 1,
      summary: `[fleet.ownership.register] error: ${err instanceof Error ? err.message : String(err)}`,
      data: { command: "fleet.ownership.register", systemId, error: String(err) },
    };
  }
}

export async function runFleetOwnershipVerify(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult> {
  const systemId = flagString(input, "id");
  if (!systemId) {
    return {
      exitCode: 1,
      summary: "fleet.ownership.verify: --id flag is required",
      data: { error: "missing --id flag" },
    };
  }

  try {
    const result = await verifyOwnership({
      systemId,
      werkstattRoot: context.workspaceRoot,
    });

    if (!result.registered) {
      return {
        exitCode: 0,
        summary: `[fleet.ownership.verify] ${systemId} not registered`,
        data: {
          command: "fleet.ownership.verify",
          systemId,
          ...result,
        },
      };
    }

    return {
      exitCode: 0,
      summary: `[fleet.ownership.verify] ${systemId} registered to ${result.claim?.creatorIdentity} on ${result.claim?.instanceId}`,
      data: {
        command: "fleet.ownership.verify",
        systemId,
        ...result,
      },
    };
  } catch (err) {
    if (err instanceof OwnershipError) {
      return {
        exitCode: 1,
        summary: `[fleet.ownership.verify] ${err.code}: ${err.message}`,
        data: { command: "fleet.ownership.verify", systemId, error: err.code, message: err.message },
      };
    }
    return {
      exitCode: 1,
      summary: `[fleet.ownership.verify] error: ${err instanceof Error ? err.message : String(err)}`,
      data: { command: "fleet.ownership.verify", systemId, error: String(err) },
    };
  }
}

export async function runFleetOwnershipTransfer(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult> {
  const systemId = flagString(input, "id");
  const authorization = flagString(input, "authorization");

  if (!systemId) {
    return {
      exitCode: 1,
      summary: "fleet.ownership.transfer: --id flag is required",
      data: { error: "missing --id flag" },
    };
  }
  if (!authorization) {
    return {
      exitCode: 1,
      summary: "fleet.ownership.transfer: --authorization flag is required",
      data: { error: "missing --authorization flag" },
    };
  }

  try {
    const result = await transferOwnership({
      systemId,
      werkstattRoot: context.workspaceRoot,
      authorizationPath: authorization,
    });

    return {
      exitCode: 0,
      summary: `[fleet.ownership.transfer] ${systemId} transferred from ${result.previousClaim.instanceId} to ${result.newClaim.instanceId}`,
      data: {
        command: "fleet.ownership.transfer",
        systemId,
        ...result,
      },
    };
  } catch (err) {
    if (err instanceof OwnershipError) {
      return {
        exitCode: 1,
        summary: `[fleet.ownership.transfer] ${err.code}: ${err.message}`,
        data: { command: "fleet.ownership.transfer", systemId, error: err.code, message: err.message },
      };
    }
    return {
      exitCode: 1,
      summary: `[fleet.ownership.transfer] error: ${err instanceof Error ? err.message : String(err)}`,
      data: { command: "fleet.ownership.transfer", systemId, error: String(err) },
    };
  }
}
