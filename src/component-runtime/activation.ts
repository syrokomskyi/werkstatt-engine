import type {
  ResolvedComponentSetV1,
  ResolvedComponentIdentityV1,
} from "../component/contracts.ts";
import { ComponentFiber } from "./fiber.ts";
import type { QuiescenceResult, Deadline } from "./fiber.ts";
import type { EffectUnwindReportV1 } from "./effects.ts";

export type ActivationState =
  "idle" | "preparing" | "committing" | "aborting" | "committed" | "aborted" | "quarantined";

export interface ActivationTransactionV1 {
  readonly transactionId: string;
  readonly priorSetHash: string;
  readonly proposedSetHash: string;
  prepare(): Promise<void>;
  commit(): Promise<void>;
  abort(reason: string): Promise<void>;
}

export interface ActivationResult {
  readonly state: ActivationState;
  readonly transactionId: string;
  readonly priorSetHash: string;
  readonly proposedSetHash: string;
  readonly fibers: readonly ComponentFiber[];
  readonly drainResults: readonly QuiescenceResult[];
  readonly unwindReports: readonly EffectUnwindReportV1[];
  readonly error: string | null;
  readonly quarantined: boolean;
}

interface ActivationConfig {
  readonly transactionId: string;
  readonly priorSet: ResolvedComponentSetV1 | null;
  readonly proposedSet: ResolvedComponentSetV1;
  readonly createFiber: (identity: ResolvedComponentIdentityV1) => ComponentFiber;
  readonly drainDeadline: Deadline;
}

function sortByDependency(
  components: readonly ResolvedComponentIdentityV1[],
): readonly ResolvedComponentIdentityV1[] {
  return [...components].sort((a, b) => {
    const ka = `${a.componentId}@${a.version}`;
    const kb = `${b.componentId}@${b.version}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

export class ActivationTransaction implements ActivationTransactionV1 {
  readonly transactionId: string;
  readonly priorSetHash: string;
  readonly proposedSetHash: string;

  private _state: ActivationState = "idle";
  private readonly config: ActivationConfig;
  private newFibers: ComponentFiber[] = [];
  private priorFibers: ComponentFiber[] = [];
  private drainResults: QuiescenceResult[] = [];
  private unwindReports: EffectUnwindReportV1[] = [];
  private error: string | null = null;

  constructor(config: ActivationConfig) {
    this.config = config;
    this.transactionId = config.transactionId;
    this.priorSetHash = config.priorSet?.setHash ?? "sha256:" + "0".repeat(64);
    this.proposedSetHash = config.proposedSet.setHash;
  }

  get state(): ActivationState {
    return this._state;
  }

  get fibers(): readonly ComponentFiber[] {
    return this.newFibers;
  }

  get result(): ActivationResult {
    return {
      state: this._state,
      transactionId: this.transactionId,
      priorSetHash: this.priorSetHash,
      proposedSetHash: this.proposedSetHash,
      fibers: this.newFibers,
      drainResults: this.drainResults,
      unwindReports: this.unwindReports,
      error: this.error,
      quarantined: this._state === "quarantined",
    };
  }

  async prepare(): Promise<void> {
    if (this._state !== "idle") {
      throw new Error(`ACTIVATION-01: prepare requires idle state, got ${this._state}`);
    }
    this._state = "preparing";

    try {
      const sorted = sortByDependency(this.config.proposedSet.components);
      this.newFibers = sorted.map((id) => this.config.createFiber(id));

      for (const fiber of this.newFibers) {
        const r = fiber.transitionTo("waiting");
        if (!r.ok) {
          throw new Error(
            `ACTIVATION-02: cannot transition ${fiber.component.componentId} to waiting: ${r.message}`,
          );
        }
      }

      for (const fiber of this.newFibers) {
        const r = fiber.transitionTo("loading");
        if (!r.ok) {
          throw new Error(
            `ACTIVATION-03: cannot transition ${fiber.component.componentId} to loading: ${r.message}`,
          );
        }
      }

      for (const fiber of this.newFibers) {
        const r = fiber.transitionTo("active");
        if (!r.ok) {
          throw new Error(
            `ACTIVATION-04: cannot transition ${fiber.component.componentId} to active: ${r.message}`,
          );
        }
      }
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      await this.abort(this.error);
      throw e;
    }
  }

  async commit(): Promise<void> {
    if (this._state !== "preparing") {
      throw new Error(`ACTIVATION-05: commit requires preparing state, got ${this._state}`);
    }
    this._state = "committing";

    if (this.config.priorSet) {
      const priorSorted = sortByDependency(this.config.priorSet.components);
      this.priorFibers = priorSorted.map((id) => this.config.createFiber(id));

      const reversed = [...this.priorFibers].reverse();
      for (const fiber of reversed) {
        const drainResult = await fiber.drain(this.config.drainDeadline);
        this.drainResults.push(drainResult);
        if (drainResult.timedOut) {
          this.error = `ACTIVATION-06: drain timeout for ${fiber.component.componentId}`;
          await this.abort(this.error);
          throw new Error(this.error);
        }
      }

      for (const fiber of reversed) {
        const report = await fiber.dispose();
        this.unwindReports.push(report);
        if (report.quarantined) {
          this.error = `ACTIVATION-07: quarantine during prior-set unwind for ${fiber.component.componentId}`;
          this._state = "quarantined";
          throw new Error(this.error);
        }
      }
    }

    this._state = "committed";
  }

  async abort(reason: string): Promise<void> {
    if (this._state === "aborted" || this._state === "quarantined") {
      return;
    }
    this._state = "aborting";
    this.error = reason;

    const reversed = [...this.newFibers].reverse();
    for (const fiber of reversed) {
      if (!fiber.isTerminal) {
        const report = await fiber.dispose();
        this.unwindReports.push(report);
        if (report.quarantined) {
          this._state = "quarantined";
          return;
        }
      }
    }

    this._state = "aborted";
  }

  get isCommitted(): boolean {
    return this._state === "committed";
  }

  get isAborted(): boolean {
    return this._state === "aborted";
  }

  get isQuarantined(): boolean {
    return this._state === "quarantined";
  }
}

export function createActivationTransaction(
  transactionId: string,
  priorSet: ResolvedComponentSetV1 | null,
  proposedSet: ResolvedComponentSetV1,
  createFiber: (identity: ResolvedComponentIdentityV1) => ComponentFiber,
  drainDeadline: Deadline,
): ActivationTransaction {
  return new ActivationTransaction({
    transactionId,
    priorSet,
    proposedSet,
    createFiber,
    drainDeadline,
  });
}
