/*
<MODULE_CONTRACT>
<purpose>
RFC-1037: Effect classifier — classifies operations into one of four effect
classes before execution. The classifier registry is built at module load time
and cached for process lifetime. O(1) Map lookup from operation name to
EffectDeclarationExt.
</purpose>
<non-goals>
  <item>Does not implement probe execution — that lives in compensation-verifier.ts.</item>
  <item>Does not register commands — registration lives in effects.module.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1037: initial implementation — EffectClassifier with default operation registry.</item>
</CHANGE_SUMMARY>
*/

import type {
  EffectClass,
  EffectDeclarationExt,
} from "../component/contracts.ts";

export class EffectClassifier {
  private readonly registry: Map<string, EffectDeclarationExt>;

  constructor(declarations: readonly EffectDeclarationExt[] = []) {
    this.registry = new Map(declarations.map((d) => [d.recoveryCommand ?? d.description, d]));
  }

  classify(operation: string): EffectClass {
    const decl = this.registry.get(operation);
    if (!decl) {
      throw new Error(`EFFECT-03: operation "${operation}" has no effect class declaration`);
    }
    return decl.effectClass;
  }

  getDeclaration(operation: string): EffectDeclarationExt | null {
    return this.registry.get(operation) ?? null;
  }

  has(operation: string): boolean {
    return this.registry.has(operation);
  }
}

const DEFAULT_DECLARATIONS: readonly EffectDeclarationExt[] = [
  {
    effectClass: "compensatable",
    description: "Deploy to dev channel",
    recoveryCommand: "leitstand.dev-deploy",
    commitMetadata: null,
    compensation: {
      compensatingOperation: "leitstand.dev-deploy.rollback",
      verificationProbes: [
        { type: "http-status", target: "https://dev.example.com", expected: "200", timeoutMs: 30000 },
      ],
      verificationTimeoutMs: 30000,
      failureMode: "blocking",
    },
  },
  {
    effectClass: "compensatable",
    description: "Propagate to deployment channel",
    recoveryCommand: "leitstand.propagate",
    commitMetadata: null,
    compensation: {
      compensatingOperation: "leitstand.propagate.rollback",
      verificationProbes: [
        { type: "http-status", target: "https://example.com", expected: "200", timeoutMs: 30000 },
      ],
      verificationTimeoutMs: 30000,
      failureMode: "blocking",
    },
  },
  {
    effectClass: "irreversible-emission",
    description: "Close mission (commit boundary)",
    recoveryCommand: "mission.close",
    commitMetadata: null,
    commitBoundary: "mission.close",
  },
  {
    effectClass: "irreversible-emission",
    description: "Commit bordbuch entry (commit boundary)",
    recoveryCommand: "bordbuch.commit",
    commitMetadata: null,
    commitBoundary: "bordbuch.commit",
  },
  {
    effectClass: "compensatable",
    description: "Synchronize sternsystem mirrors",
    recoveryCommand: "sternsystem.sync",
    commitMetadata: null,
    compensation: {
      compensatingOperation: "sternsystem.sync.rollback",
      verificationProbes: [
        { type: "mirror-synced", target: "origin", expected: "", timeoutMs: 30000 },
      ],
      verificationTimeoutMs: 30000,
      failureMode: "non-blocking",
    },
  },
  {
    effectClass: "irreversible-emission",
    description: "Prepare release (commit boundary)",
    recoveryCommand: "release.prepare",
    commitMetadata: null,
    commitBoundary: "release.prepare",
  },
];

let defaultClassifier: EffectClassifier | null = null;

export function getDefaultEffectClassifier(): EffectClassifier {
  if (!defaultClassifier) {
    defaultClassifier = new EffectClassifier(DEFAULT_DECLARATIONS);
  }
  return defaultClassifier;
}

export function resetDefaultEffectClassifier(): void {
  defaultClassifier = null;
}
