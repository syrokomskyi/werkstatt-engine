/*
<MODULE_CONTRACT>
<purpose>RFC-0750: appendAndCommitBordbuch and appendBatchAndCommitBordbuch helpers that combine appendBordbuchEntry + commitAndPushBordbuch into one atomic operation.</purpose>
<non-goals>
  <item>Does not define bordbuch event schema — that lives in @warpgogol/werkstatt-shared/ontology/operations.</item>
  <item>Does not implement git operations — those live in bordbuch-io.ts commitAndPushBordbuch.</item>
  <item>Does not throw on commit/push failure — returns commitResult for caller to decide.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0750: initial appendAndCommitBordbuch and appendBatchAndCommitBordbuch helpers.</item>
</CHANGE_SUMMARY>
*/

import type { BordbuchEntry, BordbuchEntryKind } from "@warpgogol/werkstatt-engine/schemas";
import {
  appendBordbuchEntry,
  commitAndPushBordbuch,
  type CommitAndPushResult,
} from "./bordbuch-io.ts";
import { resolveCacheClonePath } from "../sternsystem/registry-io.ts";

export interface AppendAndCommitResult {
  entry: BordbuchEntry;
  commitResult: CommitAndPushResult;
}

export interface AppendBatchAndCommitResult {
  entries: BordbuchEntry[];
  commitResult: CommitAndPushResult;
}

export interface AppendBordbuchOptions {
  missionId?: string | null;
  releaseId?: string | null;
  writerRole?: string;
  metadata?: Record<string, unknown>;
  status?: BordbuchEntry["status"];
  erratumOf?: string;
}

export interface BatchBordbuchEntrySpec {
  kind: BordbuchEntryKind;
  summary: string;
  actor: string;
  options?: AppendBordbuchOptions;
}

export async function appendAndCommitBordbuch(
  workspaceRoot: string,
  systemId: string,
  kind: BordbuchEntryKind,
  summary: string,
  actor: string,
  options?: AppendBordbuchOptions,
  commitMessage?: string,
): Promise<AppendAndCommitResult> {
  const entry = await appendBordbuchEntry(workspaceRoot, systemId, kind, summary, actor, options);

  const systemDir = await resolveCacheClonePath(workspaceRoot, systemId);
  const message = commitMessage ?? `Bordbuch: ${kind} ${systemId}`;
  const commitResult = await commitAndPushBordbuch(systemDir, message);

  return { entry, commitResult };
}

export async function appendBatchAndCommitBordbuch(
  workspaceRoot: string,
  systemId: string,
  entries: BatchBordbuchEntrySpec[],
  commitMessage: string,
): Promise<AppendBatchAndCommitResult> {
  const appended: BordbuchEntry[] = [];

  for (const spec of entries) {
    const entry = await appendBordbuchEntry(
      workspaceRoot,
      systemId,
      spec.kind,
      spec.summary,
      spec.actor,
      spec.options,
    );
    appended.push(entry);
  }

  const systemDir = await resolveCacheClonePath(workspaceRoot, systemId);
  const commitResult = await commitAndPushBordbuch(systemDir, commitMessage);

  return { entries: appended, commitResult };
}
