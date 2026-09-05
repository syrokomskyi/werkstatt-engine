/*
<MODULE_CONTRACT>
<purpose>
Overlay resolution for desired-state composition (RFC-1038). Applies layered
patches (DesiredStateOverlay) to a base DesiredState, detecting conflicts
when two overlays with the same priority modify the same componentId.
</purpose>
<non-goals>
  <item>Does not implement reconciliation — see reconciler.ts.</item>
  <item>Does not persist overlays — overlay storage is managed by the composition commands.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1038: initial implementation — overlay resolution with conflict detection (COMPOSITION-01).</item>
</CHANGE_SUMMARY>
*/

import type {
  DesiredState,
  ComponentDeclaration,
  DesiredStateOverlay,
} from "./desired-state.ts";

/**
 * Overlay conflict error — thrown when two overlays with the same priority
 * have addOrReplace entries for the same componentId (COMPOSITION-01).
 */
export class OverlayConflictError extends Error {
  readonly code = "COMPOSITION-01";
  constructor(
    readonly overlay1Id: string,
    readonly overlay2Id: string,
    readonly componentId: string,
    readonly priority: number,
  ) {
    super(
      `COMPOSITION-01: Overlay conflict — overlays "${overlay1Id}" and "${overlay2Id}" both modify component "${componentId}" at priority ${priority}`,
    );
    this.name = "OverlayConflictError";
  }
}

/**
 * Scope priority order (innermost first, highest priority).
 * per-command > per-mission > per-session > per-workshop > per-fleet
 */
const SCOPE_ORDER: Record<string, number> = {
  "per-command": 0,
  "per-mission": 1,
  "per-session": 2,
  "per-workshop": 3,
  "per-fleet": 4,
};

/**
 * Resolve overlays against a base desired state.
 *
 * Overlays are applied in scope order (innermost first), then by priority
 * (higher priority overrides lower within the same scope). The final desired
 * state is the merge of all applicable overlays.
 *
 * @throws {OverlayConflictError} when two overlays with the same priority
 *   have addOrReplace entries for the same componentId (COMPOSITION-01).
 */
export function resolveOverlays(
  base: DesiredState,
  overlays: DesiredStateOverlay[],
): DesiredState {
  if (overlays.length === 0) return base;

  const sorted = [...overlays].sort((a, b) => {
    const scopeDiff = SCOPE_ORDER[a.scope]! - SCOPE_ORDER[b.scope]!;
    if (scopeDiff !== 0) return scopeDiff;
    return b.priority - a.priority;
  });

  const merged = new Map(base.components);
  const seenPriorities = new Map<
    number,
    Map<string, string>
  >();

  for (const overlay of sorted) {
    for (const [componentId, declaration] of overlay.addOrReplace) {
      const priorityMap = seenPriorities.get(overlay.priority);
      if (priorityMap) {
        const existingOverlayId = priorityMap.get(componentId);
        if (existingOverlayId && existingOverlayId !== overlay.id) {
          throw new OverlayConflictError(
            existingOverlayId,
            overlay.id,
            componentId,
            overlay.priority,
          );
        }
      } else {
        seenPriorities.set(overlay.priority, new Map());
      }
      seenPriorities.get(overlay.priority)!.set(componentId, overlay.id);
      merged.set(componentId, declaration);
    }

    for (const componentId of overlay.remove) {
      merged.delete(componentId);
    }
  }

  return {
    ...base,
    components: merged,
  };
}

/**
 * Inspect overlays — returns a summary of each overlay's effects.
 */
export function inspectOverlays(
  overlays: DesiredStateOverlay[],
): Array<{
  id: string;
  scope: string;
  priority: number;
  addCount: number;
  removeCount: number;
}> {
  return overlays.map((overlay) => ({
    id: overlay.id,
    scope: overlay.scope,
    priority: overlay.priority,
    addCount: overlay.addOrReplace.size,
    removeCount: overlay.remove.length,
  }));
}
