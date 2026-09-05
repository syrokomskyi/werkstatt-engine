/*
<MODULE_CONTRACT>
<purpose>
RFC-1037: Thin kernel command handlers for effect.classify,
effect.compensation.verify, and effect.compensation.inspect commands.
Each handler delegates to pure functions in effect-classifier.ts and
compensation-verifier.ts and wraps the result in KernelCommandResult.
</purpose>
<non-goals>
  <item>Does not implement classification logic — that lives in effect-classifier.ts.</item>
  <item>Does not implement probe execution — that lives in compensation-verifier.ts.</item>
  <item>Does not register commands — registration lives in effects.module.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1037: initial implementation — 3 effect command handlers.</item>
</CHANGE_SUMMARY>
*/

import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "../kernel/types.ts";
import type { EffectClass, CompensationResult } from "../component/contracts.ts";
import type { Sha256Digest } from "../fingerprint/primitives.ts";
import { isSha256Digest } from "../fingerprint/primitives.ts";
import { getDefaultEffectClassifier } from "./effect-classifier.ts";
import { CompensationVerifier } from "./compensation-verifier.ts";
import { CompensationStore, resolveCompensationStorePath } from "./compensation-store.ts";

export interface ClassifyResult {
  operation: string;
  effectClass: EffectClass;
}

export function runEffectClassify(
  input: KernelCommandInput,
  _context: KernelRuntimeContext,
): KernelCommandResult<ClassifyResult> {
  const operation = input.flags["operation"] as string | undefined;
  if (!operation) {
    throw new Error("EFFECT-CMD-01: --operation flag is required");
  }

  const classifier = getDefaultEffectClassifier();
  const effectClass = classifier.classify(operation);
  return {
    data: { operation, effectClass },
    exitCode: 0,
    summary: `Operation "${operation}" classified as ${effectClass}`,
  };
}

export function runEffectCompensationVerify(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<CompensationResult>> {
  const operationHash = input.flags["operation-hash"] as string | undefined;
  const compensationHash = input.flags["compensation-hash"] as string | undefined;

  if (!operationHash || !isSha256Digest(operationHash)) {
    throw new Error("EFFECT-CMD-02: --operation-hash flag (sha256:...) is required");
  }
  if (!compensationHash || !isSha256Digest(compensationHash)) {
    throw new Error("EFFECT-CMD-03: --compensation-hash flag (sha256:...) is required");
  }

  const operation = input.flags["operation"] as string | undefined;
  if (!operation) {
    throw new Error("EFFECT-CMD-04: --operation flag is required to resolve compensation action");
  }

  const classifier = getDefaultEffectClassifier();
  const decl = classifier.getDeclaration(operation);
  if (!decl) {
    throw new Error(`EFFECT-03: operation "${operation}" has no effect class declaration`);
  }
  if (decl.effectClass === "irreversible-emission") {
    throw new Error("EFFECT-01: irreversible emissions cannot be compensated");
  }
  if (!decl.compensation) {
    throw new Error("EFFECT-02: compensatable operation requires a compensation action");
  }

  const workspaceRoot =
    (context as unknown as { workspaceRoot?: string }).workspaceRoot ?? process.cwd();
  const missionId = input.flags["mission-id"] as string | undefined;
  const missionsDir =
    (input.flags["missions-dir"] as string | undefined) ?? `${workspaceRoot}/missions`;
  const storePath = missionId
    ? resolveCompensationStorePath(missionsDir, missionId)
    : `${workspaceRoot}/missions/_global/compensation-evidence.db`;

  const store = new CompensationStore(storePath);
  const verifier = new CompensationVerifier(store, context);

  return verifier
    .verify(operationHash as Sha256Digest, compensationHash as Sha256Digest, decl.compensation)
    .then((result) => {
      store.close();
      return {
        data: result,
        exitCode: result.verified ? 0 : 1,
        summary: result.verified
          ? `Compensation verified for ${operationHash}`
          : `Compensation verification failed for ${operationHash}: ${result.failureReason ?? "unknown"}`,
      };
    })
    .catch((err) => {
      store.close();
      throw err;
    });
}

export function runEffectCompensationInspect(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): KernelCommandResult<CompensationResult | null> {
  const operationHash = input.flags["operation-hash"] as string | undefined;
  if (!operationHash || !isSha256Digest(operationHash)) {
    throw new Error("EFFECT-CMD-02: --operation-hash flag (sha256:...) is required");
  }

  const workspaceRoot =
    (context as unknown as { workspaceRoot?: string }).workspaceRoot ?? process.cwd();
  const missionId = input.flags["mission-id"] as string | undefined;
  const missionsDir =
    (input.flags["missions-dir"] as string | undefined) ?? `${workspaceRoot}/missions`;
  const storePath = missionId
    ? resolveCompensationStorePath(missionsDir, missionId)
    : `${workspaceRoot}/missions/_global/compensation-evidence.db`;

  const store = new CompensationStore(storePath);
  const result = store.get(operationHash as Sha256Digest);
  store.close();

  return {
    data: result,
    exitCode: 0,
    summary: result
      ? `Compensation evidence found for ${operationHash}: verified=${result.verified}`
      : `No compensation evidence found for ${operationHash}`,
  };
}
