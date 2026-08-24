/*
<MODULE_CONTRACT>
<purpose>Facilitates extraction and formatting of issue and pull request links from commit messages.</purpose>
<non-goals>
  <item>Do not parse raw commit content beyond link extraction.</item>
  <item>Do not handle network requests or external API interactions.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Tidied by compass.changesummary.tidy; see git history for prior entries.</item>
</CHANGE_SUMMARY>
*/

import type { RawCommit } from "../types.ts";

export interface CommitLink {
  number: string;
  url: string;
}

export interface CommitLinks {
  issues: CommitLink[];
  prs: CommitLink[];
}

// Matches: closes #321, fixes #42, resolves #7 (case-insensitive, with optional "s")
const ISSUE_REF = /(?:closes?|fixes?|resolves?)\s+#(\d+)/gi;
// Matches trailing PR references like "(#328)" common in squash-merge titles
const PR_REF = /\(#(\d+)\)/g;

/**
 * [CL-LINKS][extractLinks]
 * Extracts issue and PR references from a commit message or body.
 * When repoUrl is provided, builds full GitHub URLs.
 * When absent, uses bare "#N" as the URL (still linkable in many renderers).
 */
export function extractLinks(text: string, repoUrl?: string): CommitLinks {
  const base = repoUrl?.replace(/\/$/, "") ?? "";

  const issues: CommitLink[] = [];
  const seenIssues = new Set<string>();
  for (const m of text.matchAll(ISSUE_REF)) {
    const n = m[1]!;
    if (!seenIssues.has(n)) {
      seenIssues.add(n);
      issues.push({ number: n, url: base ? `${base}/issues/${n}` : `#${n}` });
    }
  }

  const prs: CommitLink[] = [];
  const seenPrs = new Set<string>();
  for (const m of text.matchAll(PR_REF)) {
    const n = m[1]!;
    if (!seenPrs.has(n)) {
      seenPrs.add(n);
      prs.push({ number: n, url: base ? `${base}/pull/${n}` : `#${n}` });
    }
  }

  return { issues, prs };
}

/**
 * [CL-LINKS][formatLinksMarkdown]
 * Renders CommitLinks as a Markdown parenthetical.
 * Returns empty string when there are no links.
 *
 * @example
 * // → " (closes [#321](…/issues/321), [PR #328](…/pull/328))"
 */
export function formatLinksMarkdown(links: CommitLinks): string {
  const parts: string[] = [
    ...links.issues.map((l) => `closes [#${l.number}](${l.url})`),
    ...links.prs.map((l) => `[PR #${l.number}](${l.url})`),
  ];
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

/**
 * [CL-LINKS][buildCommitLinksMap]
 * Builds a hash → CommitLinks lookup from a RawCommit array.
 * Merges links found in both message and body.
 */
export function buildCommitLinksMap(
  commits: RawCommit[],
  repoUrl?: string,
): Map<string, CommitLinks> {
  const map = new Map<string, CommitLinks>();
  for (const commit of commits) {
    const text = [commit.message, commit.body ?? ""].join("\n");
    const links = extractLinks(text, repoUrl);
    if (links.issues.length > 0 || links.prs.length > 0) {
      map.set(commit.hash, links);
    }
  }
  return map;
}
