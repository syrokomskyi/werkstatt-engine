/*
<MODULE_CONTRACT>
<purpose>
RFC-1038: In-memory overlay store for active DesiredStateOverlay instances.
Manages the lifecycle of overlays applied to the base desired state.
Used by composition.overlay.apply and composition.overlay.inspect commands.
</purpose>
<non-goals>
  <item>Does not implement overlay resolution — see overlay.ts.</item>
  <item>Does not persist overlays to disk — persistence is a future phase.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1038: initial implementation — in-memory overlay store for composition commands.</item>
</CHANGE_SUMMARY>
*/

import type { DesiredStateOverlay } from "./desired-state.ts";

const overlays = new Map<string, DesiredStateOverlay>();

/**
 * Apply (add or replace) an overlay in the store.
 * If an overlay with the same ID already exists, it is replaced.
 */
export function applyOverlay(overlay: DesiredStateOverlay): void {
  overlays.set(overlay.id, overlay);
}

/**
 * Get all active overlays, sorted by scope order (innermost first).
 */
export function getActiveOverlays(): DesiredStateOverlay[] {
  return Array.from(overlays.values());
}

/**
 * Remove an overlay by ID. Returns true if the overlay was found and removed.
 */
export function removeOverlay(id: string): boolean {
  return overlays.delete(id);
}

/**
 * Clear all overlays (for testing).
 */
export function clearOverlays(): void {
  overlays.clear();
}
