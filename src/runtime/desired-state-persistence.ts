/*
<MODULE_CONTRACT>
<purpose>
RFC-1038 AC-13: Persistence for desired state. Writes `.werkstatt/desired-state.json`
atomically so that on process restart after a crash, the reconciler can load the
last persisted desired state, compare it with actual state, and correct drift.
</purpose>
<non-goals>
  <item>Does not implement reconciliation logic — see reconciler.ts.</item>
  <item>Does not implement overlay resolution — see overlay.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1038: initial implementation — desired-state persistence for crash recovery (AC-13).</item>
</CHANGE_SUMMARY>
*/

import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "../kernel/fs-atomic.ts";
import type { Sha256Digest } from "../fingerprint/primitives.ts";
import type { DesiredState, ComponentDeclaration } from "./desired-state.ts";

/**
 * On-disk schema for persisted desired state.
 * Maps are serialized as arrays of pairs for JSON compatibility.
 */
interface PersistedDesiredState {
  schemaVersion: "werkstatt/desired-state@1";
  components: Array<[string, ComponentDeclaration]>;
  requiredCapabilities: string[];
  availableArtifacts: Array<[string, string]>;
  admittedGrants: Array<{ scope: string; resource: string }>;
  profileId: string;
}

/**
 * Persist desired state to `.werkstatt/desired-state.json`.
 * Uses atomic write (temp file + rename) to prevent corruption on crash.
 */
export async function persistDesiredState(
  desired: DesiredState,
  workspaceRoot: string,
): Promise<void> {
  const dir = join(workspaceRoot, ".werkstatt");
  const filePath = join(dir, "desired-state.json");

  const persisted: PersistedDesiredState = {
    schemaVersion: "werkstatt/desired-state@1",
    components: Array.from(desired.components.entries()),
    requiredCapabilities: desired.requiredCapabilities,
    availableArtifacts: Array.from(desired.availableArtifacts.entries()),
    admittedGrants: [...desired.admittedGrants],
    profileId: desired.profileId,
  };

  await mkdir(dir, { recursive: true });
  await writeFileAtomic(filePath, JSON.stringify(persisted, null, 2) + "\n");
}

/**
 * Load persisted desired state from `.werkstatt/desired-state.json`.
 * Returns null if the file does not exist or is corrupt (logs warning).
 */
export async function loadPersistedDesiredState(
  workspaceRoot: string,
): Promise<DesiredState | null> {
  const filePath = join(workspaceRoot, ".werkstatt", "desired-state.json");

  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as PersistedDesiredState;

    if (
      !parsed ||
      typeof parsed !== "object" ||
      parsed.schemaVersion !== "werkstatt/desired-state@1"
    ) {
      process.stderr.write(
        `[desired-state-persistence] WARN: corrupt or incompatible schema in ${filePath} — ignoring.\n`,
      );
      return null;
    }

    return {
      components: new Map(parsed.components),
      requiredCapabilities: parsed.requiredCapabilities ?? [],
      availableArtifacts: new Map(
        (parsed.availableArtifacts ?? []).map(
          ([k, v]) => [k, v as Sha256Digest] as [string, Sha256Digest],
        ),
      ),
      admittedGrants: parsed.admittedGrants ?? [],
      profileId: parsed.profileId ?? "",
    };
  } catch (e) {
    process.stderr.write(
      `[desired-state-persistence] WARN: failed to parse ${filePath}: ${e instanceof Error ? e.message : String(e)} — ignoring.\n`,
    );
    return null;
  }
}
