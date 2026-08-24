/*
<MODULE_CONTRACT>
<purpose>Facilitates the sanitization of text inputs for prompt processing and commit messages.</purpose>
<non-goals>
  <item>Do not handle raw content parsing beyond defined sanitization rules.</item>
  <item>Do not manage commit storage or retrieval processes.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Tidied by compass.changesummary.tidy; see git history for prior entries.</item>
</CHANGE_SUMMARY>
*/

import type { RawCommit } from "../types.ts";

// START_BLOCK_SANITIZE
export function sanitizeForPrompt(text: string): string {
  return text
    .replace(/---.*?---/gs, "")
    .replace(/\[SYSTEM\]|\[ASSISTANT\]|\[USER\]/gi, "")
    .replace(/ignore (previous|all) instructions?/gi, "")
    .replace(/<\|im_start\|>|<\|im_end\|>/g, "")
    .replace(/system:\s*/gi, "")
    .replace(/assistant:\s*/gi, "")
    .trim()
    .slice(0, 2000);
}

export function sanitizeCommit(commit: RawCommit): RawCommit {
  return {
    ...commit,
    message: sanitizeForPrompt(commit.message),
    body: commit.body !== undefined ? sanitizeForPrompt(commit.body) : undefined,
    diffSummary: sanitizeForPrompt(commit.diffSummary),
  };
}
// END_BLOCK_SANITIZE
