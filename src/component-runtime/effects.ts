import type { EffectClass, EffectDeclarationV1 } from "../component/contracts.ts";
import type { ComponentId } from "../component/contracts.ts";

export type EffectOutcome =
  | "committed"
  | "aborted"
  | "compensated"
  | "withheld"
  | "failed-rollback"
  | "quarantined";

export interface EffectUnwindEntryV1 {
  readonly componentId: ComponentId;
  readonly effectClass: EffectClass;
  readonly outcome: EffectOutcome;
  readonly error: string | null;
}

export interface EffectUnwindReportV1 {
  readonly entries: readonly EffectUnwindEntryV1[];
  readonly allSucceeded: boolean;
  readonly quarantined: boolean;
}

export interface EffectHandlerResult {
  readonly ok: boolean;
  readonly outcome: EffectOutcome;
  readonly error: string | null;
}

export interface EffectHandler {
  readonly effectClass: EffectClass;
  prepare(): Promise<EffectHandlerResult>;
  commit(): Promise<EffectHandlerResult>;
  abort(): Promise<EffectHandlerResult>;
  compensate(): Promise<EffectHandlerResult>;
  dispose(): Promise<EffectHandlerResult>;
}

export class RevertibleEffectHandler implements EffectHandler {
  readonly effectClass: EffectClass = "revertible";
  private disposed = false;
  private readonly disposer: () => Promise<void>;
  private readonly onFail: (error: string) => void;

  constructor(disposer: () => Promise<void>, onFail?: (error: string) => void) {
    this.disposer = disposer;
    this.onFail = onFail ?? (() => {});
  }

  async prepare(): Promise<EffectHandlerResult> {
    return { ok: true, outcome: "committed", error: null };
  }

  async commit(): Promise<EffectHandlerResult> {
    return { ok: true, outcome: "committed", error: null };
  }

  async abort(): Promise<EffectHandlerResult> {
    if (this.disposed) {
      return { ok: true, outcome: "aborted", error: null };
    }
    return this.dispose();
  }

  async compensate(): Promise<EffectHandlerResult> {
    return { ok: false, outcome: "failed-rollback", error: "revertible effects do not support compensation; use dispose" };
  }

  async dispose(): Promise<EffectHandlerResult> {
    if (this.disposed) {
      return { ok: true, outcome: "aborted", error: null };
    }
    try {
      await this.disposer();
      this.disposed = true;
      return { ok: true, outcome: "aborted", error: null };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.onFail(msg);
      return { ok: false, outcome: "failed-rollback", error: msg };
    }
  }
}

export class TransactionalEffectHandler implements EffectHandler {
  readonly effectClass: EffectClass = "transactional";
  private prepared = false;
  private committed = false;
  private aborted = false;
  private readonly prepareFn: () => Promise<void>;
  private readonly commitFn: () => Promise<void>;
  private readonly abortFn: () => Promise<void>;
  private readonly idempotencyKey: string;

  constructor(
    idempotencyKey: string,
    prepareFn: () => Promise<void>,
    commitFn: () => Promise<void>,
    abortFn: () => Promise<void>,
  ) {
    this.idempotencyKey = idempotencyKey;
    this.prepareFn = prepareFn;
    this.commitFn = commitFn;
    this.abortFn = abortFn;
  }

  async prepare(): Promise<EffectHandlerResult> {
    if (this.prepared || this.committed || this.aborted) {
      return { ok: true, outcome: "committed", error: null };
    }
    try {
      await this.prepareFn();
      this.prepared = true;
      return { ok: true, outcome: "committed", error: null };
    } catch (e) {
      return { ok: false, outcome: "failed-rollback", error: e instanceof Error ? e.message : String(e) };
    }
  }

  async commit(): Promise<EffectHandlerResult> {
    if (this.committed) {
      return { ok: true, outcome: "committed", error: null };
    }
    if (!this.prepared) {
      return { ok: false, outcome: "failed-rollback", error: "commit called before prepare" };
    }
    try {
      await this.commitFn();
      this.committed = true;
      return { ok: true, outcome: "committed", error: null };
    } catch (e) {
      return { ok: false, outcome: "failed-rollback", error: e instanceof Error ? e.message : String(e) };
    }
  }

  async abort(): Promise<EffectHandlerResult> {
    if (this.aborted || this.committed) {
      return { ok: true, outcome: "aborted", error: null };
    }
    try {
      await this.abortFn();
      this.aborted = true;
      return { ok: true, outcome: "aborted", error: null };
    } catch (e) {
      return { ok: false, outcome: "failed-rollback", error: e instanceof Error ? e.message : String(e) };
    }
  }

  async compensate(): Promise<EffectHandlerResult> {
    return { ok: false, outcome: "failed-rollback", error: "transactional effects use abort, not compensation" };
  }

  async dispose(): Promise<EffectHandlerResult> {
    if (this.committed) {
      return { ok: true, outcome: "committed", error: null };
    }
    if (!this.aborted) {
      return this.abort();
    }
    return { ok: true, outcome: "aborted", error: null };
  }
}

export class CompensatableEffectHandler implements EffectHandler {
  readonly effectClass: EffectClass = "compensatable";
  private committed = false;
  private compensated = false;
  private readonly commitFn: () => Promise<void>;
  private readonly compensateFn: () => Promise<void>;
  private readonly equivalenceEvidence: string;

  constructor(
    commitFn: () => Promise<void>,
    compensateFn: () => Promise<void>,
    equivalenceEvidence: string,
  ) {
    if (!equivalenceEvidence.trim()) {
      throw new Error("compensatable effects require non-empty equivalence evidence");
    }
    this.commitFn = commitFn;
    this.compensateFn = compensateFn;
    this.equivalenceEvidence = equivalenceEvidence;
  }

  async prepare(): Promise<EffectHandlerResult> {
    return { ok: true, outcome: "committed", error: null };
  }

  async commit(): Promise<EffectHandlerResult> {
    if (this.committed) {
      return { ok: true, outcome: "committed", error: null };
    }
    try {
      await this.commitFn();
      this.committed = true;
      return { ok: true, outcome: "committed", error: null };
    } catch (e) {
      return { ok: false, outcome: "failed-rollback", error: e instanceof Error ? e.message : String(e) };
    }
  }

  async abort(): Promise<EffectHandlerResult> {
    if (!this.committed) {
      return { ok: true, outcome: "aborted", error: null };
    }
    return this.compensate();
  }

  async compensate(): Promise<EffectHandlerResult> {
    if (this.compensated) {
      return { ok: true, outcome: "compensated", error: null };
    }
    if (!this.committed) {
      return { ok: true, outcome: "aborted", error: null };
    }
    try {
      await this.compensateFn();
      this.compensated = true;
      return { ok: true, outcome: "compensated", error: null };
    } catch (e) {
      return { ok: false, outcome: "quarantined", error: e instanceof Error ? e.message : String(e) };
    }
  }

  async dispose(): Promise<EffectHandlerResult> {
    if (this.committed && !this.compensated) {
      return this.compensate();
    }
    return { ok: true, outcome: this.compensated ? "compensated" : "aborted", error: null };
  }
}

export class IrreversibleEmissionEffectHandler implements EffectHandler {
  readonly effectClass: EffectClass = "irreversible-emission";
  private withheld = true;
  private emitted = false;
  private readonly emitFn: () => Promise<void>;

  constructor(emitFn: () => Promise<void>) {
    this.emitFn = emitFn;
  }

  async prepare(): Promise<EffectHandlerResult> {
    return { ok: true, outcome: "withheld", error: null };
  }

  async commit(): Promise<EffectHandlerResult> {
    if (this.emitted) {
      return { ok: true, outcome: "committed", error: null };
    }
    try {
      await this.emitFn();
      this.emitted = true;
      this.withheld = false;
      return { ok: true, outcome: "committed", error: null };
    } catch (e) {
      return { ok: false, outcome: "failed-rollback", error: e instanceof Error ? e.message : String(e) };
    }
  }

  async abort(): Promise<EffectHandlerResult> {
    if (this.emitted) {
      return { ok: false, outcome: "quarantined", error: "irreversible emission already emitted; cannot abort" };
    }
    this.withheld = false;
    return { ok: true, outcome: "aborted", error: null };
  }

  async compensate(): Promise<EffectHandlerResult> {
    if (this.emitted) {
      return { ok: false, outcome: "quarantined", error: "irreversible emissions cannot be compensated" };
    }
    return { ok: true, outcome: "withheld", error: null };
  }

  async dispose(): Promise<EffectHandlerResult> {
    if (this.withheld && !this.emitted) {
      return { ok: true, outcome: "withheld", error: null };
    }
    if (this.emitted) {
      return { ok: true, outcome: "committed", error: null };
    }
    return { ok: true, outcome: "aborted", error: null };
  }

  get isWithheld(): boolean {
    return this.withheld;
  }
}

export function createEffectHandler(
  declaration: EffectDeclarationV1,
  handlers: {
    disposer?: () => Promise<void>;
    prepare?: () => Promise<void>;
    commit?: () => Promise<void>;
    abort?: () => Promise<void>;
    compensate?: () => Promise<void>;
    emit?: () => Promise<void>;
    equivalenceEvidence?: string;
  },
): EffectHandler {
  switch (declaration.effectClass) {
    case "revertible":
      return new RevertibleEffectHandler(handlers.disposer ?? (async () => {}));
    case "transactional":
      return new TransactionalEffectHandler(
        declaration.commitMetadata ?? "tx-key",
        handlers.prepare ?? (async () => {}),
        handlers.commit ?? (async () => {}),
        handlers.abort ?? (async () => {}),
      );
    case "compensatable":
      return new CompensatableEffectHandler(
        handlers.commit ?? (async () => {}),
        handlers.compensate ?? (async () => {}),
        handlers.equivalenceEvidence ?? "",
      );
    case "irreversible-emission":
      return new IrreversibleEmissionEffectHandler(
        handlers.emit ?? (async () => {}),
      );
    default: {
      const _exhaustive: never = declaration.effectClass;
      throw new Error(`unknown effect class: ${_exhaustive}`);
    }
  }
}

export function buildUnwindReport(
  entries: readonly EffectUnwindEntryV1[],
): EffectUnwindReportV1 {
  const allSucceeded = entries.every(
    (e) => e.outcome === "aborted" || e.outcome === "compensated" || e.outcome === "withheld" || e.outcome === "committed",
  );
  const quarantined = entries.some((e) => e.outcome === "quarantined" || e.outcome === "failed-rollback");
  return { entries, allSucceeded: allSucceeded && !quarantined, quarantined };
}
