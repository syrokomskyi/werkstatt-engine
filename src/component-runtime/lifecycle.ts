import type { ResolvedComponentIdentityV1 } from "../component/contracts.ts";

export type ComponentLifecycleState =
  | "declared"
  | "waiting"
  | "loading"
  | "active"
  | "draining"
  | "unloading"
  | "disposed"
  | "failed"
  | "quarantined";

const VALID_TRANSITIONS: Record<ComponentLifecycleState, readonly ComponentLifecycleState[]> = {
  declared: ["waiting", "failed"],
  waiting: ["loading", "failed"],
  loading: ["active", "failed"],
  active: ["draining", "failed", "quarantined"],
  draining: ["unloading", "failed", "quarantined"],
  unloading: ["disposed", "failed", "quarantined"],
  disposed: [],
  failed: ["quarantined"],
  quarantined: [],
};

export interface LifecycleTransitionResult {
  readonly ok: true;
  readonly from: ComponentLifecycleState;
  readonly to: ComponentLifecycleState;
}

export interface LifecycleTransitionError {
  readonly ok: false;
  readonly from: ComponentLifecycleState;
  readonly to: ComponentLifecycleState;
  readonly rule: string;
  readonly message: string;
}

export type LifecycleTransitionOutcome = LifecycleTransitionResult | LifecycleTransitionError;

export function isValidTransition(
  from: ComponentLifecycleState,
  to: ComponentLifecycleState,
): boolean {
  const allowed = VALID_TRANSITIONS[from];
  return allowed !== undefined && allowed.includes(to);
}

export function transition(
  from: ComponentLifecycleState,
  to: ComponentLifecycleState,
): LifecycleTransitionOutcome {
  if (from === to) {
    return {
      ok: false,
      from,
      to,
      rule: "LIFECYCLE-01",
      message: `self-transition is not valid: ${from} -> ${to}`,
    };
  }
  if (!isValidTransition(from, to)) {
    return {
      ok: false,
      from,
      to,
      rule: "LIFECYCLE-02",
      message: `invalid transition: ${from} -> ${to}`,
    };
  }
  return { ok: true, from, to };
}

export function isTerminal(state: ComponentLifecycleState): boolean {
  return state === "disposed" || state === "quarantined";
}

export function isActive(state: ComponentLifecycleState): boolean {
  return state === "active";
}

export function isDraining(state: ComponentLifecycleState): boolean {
  return state === "draining" || state === "unloading";
}

export function canAcceptNewCalls(state: ComponentLifecycleState): boolean {
  return state === "active";
}

export function canCancel(state: ComponentLifecycleState): boolean {
  return state === "active" || state === "draining";
}

export interface ComponentLifecycle {
  readonly component: ResolvedComponentIdentityV1;
  readonly state: ComponentLifecycleState;
}

export class LifecycleMachine {
  private _state: ComponentLifecycleState;
  readonly component: ResolvedComponentIdentityV1;

  constructor(component: ResolvedComponentIdentityV1, initial: ComponentLifecycleState = "declared") {
    this.component = component;
    this._state = initial;
  }

  get state(): ComponentLifecycleState {
    return this._state;
  }

  transitionTo(target: ComponentLifecycleState): LifecycleTransitionOutcome {
    const result = transition(this._state, target);
    if (result.ok) {
      this._state = target;
    }
    return result;
  }

  get isTerminal(): boolean {
    return isTerminal(this._state);
  }

  get canAcceptNewCalls(): boolean {
    return canAcceptNewCalls(this._state);
  }

  get isDraining(): boolean {
    return isDraining(this._state);
  }
}
