import type { ResolvedComponentIdentityV1 } from "../component/contracts.ts";
import { LifecycleMachine, type ComponentLifecycleState } from "./lifecycle.ts";
import type { EffectUnwindReportV1, EffectUnwindEntryV1, EffectHandler } from "./effects.ts";

export interface Deadline {
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

export interface QuiescenceResult {
  readonly drained: boolean;
  readonly timedOut: boolean;
  readonly remainingOperations: number;
  readonly durationMs: number;
}

export interface OwnedOperation<T> {
  readonly id: string;
  readonly execute: (signal: AbortSignal) => Promise<T>;
  readonly cancellationPoint?: () => boolean;
}

interface RunningOperation {
  id: string;
  controller: AbortController;
  promise: Promise<unknown>;
  startedAt: number;
}

export class ComponentFiber {
  readonly component: ResolvedComponentIdentityV1;
  private readonly lifecycle: LifecycleMachine;
  private readonly operations: Map<string, RunningOperation> = new Map();
  private readonly effects: Map<string, EffectHandler> = new Map();
  private readonly children: ComponentFiber[] = [];
  private disposed = false;

  constructor(component: ResolvedComponentIdentityV1, initial?: ComponentLifecycleState) {
    this.component = component;
    this.lifecycle = new LifecycleMachine(component, initial);
  }

  get state(): ComponentLifecycleState {
    return this.lifecycle.state;
  }

  get isTerminal(): boolean {
    return this.lifecycle.isTerminal;
  }

  get canAcceptNewCalls(): boolean {
    return this.lifecycle.canAcceptNewCalls;
  }

  get activeOperationCount(): number {
    return this.operations.size;
  }

  transitionTo(target: ComponentLifecycleState) {
    return this.lifecycle.transitionTo(target);
  }

  registerEffect(id: string, handler: EffectHandler): void {
    if (this.disposed) {
      throw new Error(
        `FIBER-01: cannot register effect on disposed fiber for ${this.component.componentId}`,
      );
    }
    this.effects.set(id, handler);
  }

  addChild(child: ComponentFiber): void {
    if (this.disposed) {
      throw new Error(
        `FIBER-02: cannot add child to disposed fiber for ${this.component.componentId}`,
      );
    }
    this.children.push(child);
  }

  async run<T>(operation: OwnedOperation<T>): Promise<T> {
    if (!this.lifecycle.canAcceptNewCalls) {
      throw new Error(
        `FIBER-03: fiber ${this.component.componentId} cannot accept new calls in state ${this.lifecycle.state}`,
      );
    }
    const controller = new AbortController();
    const startedAt = Date.now();
    const promise = operation.execute(controller.signal);
    const entry: RunningOperation = { id: operation.id, controller, promise, startedAt };
    this.operations.set(operation.id, entry);

    try {
      const result = await promise;
      this.operations.delete(operation.id);
      return result as T;
    } catch (e) {
      this.operations.delete(operation.id);
      throw e;
    }
  }

  async drain(deadline: Deadline): Promise<QuiescenceResult> {
    const start = Date.now();
    const drainResult = this.lifecycle.transitionTo("draining");
    if (!drainResult.ok) {
      return {
        drained: this.operations.size === 0,
        timedOut: false,
        remainingOperations: this.operations.size,
        durationMs: 0,
      };
    }

    const deadlineMs = start + deadline.timeoutMs;
    while (this.operations.size > 0) {
      const now = Date.now();
      if (now >= deadlineMs) {
        return {
          drained: false,
          timedOut: true,
          remainingOperations: this.operations.size,
          durationMs: now - start,
        };
      }
      if (deadline.signal?.aborted) {
        return {
          drained: false,
          timedOut: true,
          remainingOperations: this.operations.size,
          durationMs: now - start,
        };
      }
      const ops = Array.from(this.operations.values());
      const sleepMs = Math.min(10, deadlineMs - now);
      await Promise.race([
        Promise.allSettled(ops.map((o) => o.promise)),
        new Promise<void>((resolve) => setTimeout(resolve, sleepMs)),
      ]);
    }

    return {
      drained: true,
      timedOut: false,
      remainingOperations: 0,
      durationMs: Date.now() - start,
    };
  }

  cancelAllOperations(): void {
    if (!this.lifecycle.isDraining && this.lifecycle.state !== "active") {
      return;
    }
    for (const op of this.operations.values()) {
      op.controller.abort();
    }
  }

  async dispose(): Promise<EffectUnwindReportV1> {
    if (this.disposed) {
      return { entries: [], allSucceeded: true, quarantined: false };
    }

    if (this.lifecycle.state === "active") {
      this.lifecycle.transitionTo("draining");
    }

    if (this.lifecycle.state === "draining") {
      this.lifecycle.transitionTo("unloading");
    }

    this.cancelAllOperations();

    for (const child of this.children) {
      await child.dispose();
    }

    const entries: EffectUnwindEntryV1[] = [];
    const effectIds = Array.from(this.effects.keys()).reverse();

    for (const id of effectIds) {
      const handler = this.effects.get(id)!;
      try {
        const result = await handler.dispose();
        entries.push({
          componentId: this.component.componentId,
          effectClass: handler.effectClass,
          outcome: result.outcome,
          error: result.error,
        });
      } catch (e) {
        entries.push({
          componentId: this.component.componentId,
          effectClass: handler.effectClass,
          outcome: "failed-rollback",
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    this.effects.clear();
    this.disposed = true;

    const report: EffectUnwindReportV1 = {
      entries,
      allSucceeded:
        entries.every(
          (e) =>
            e.outcome === "aborted" ||
            e.outcome === "compensated" ||
            e.outcome === "withheld" ||
            e.outcome === "committed",
        ) && !entries.some((e) => e.outcome === "quarantined" || e.outcome === "failed-rollback"),
      quarantined: entries.some(
        (e) => e.outcome === "quarantined" || e.outcome === "failed-rollback",
      ),
    };

    if (report.quarantined) {
      this.lifecycle.transitionTo("quarantined");
    } else {
      this.lifecycle.transitionTo("disposed");
    }

    return report;
  }
}
