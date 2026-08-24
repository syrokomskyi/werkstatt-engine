import { describe, it, expect } from "vitest";
import {
  extractLinks,
  formatLinksMarkdown,
  buildCommitLinksMap,
} from "../changelog/utils/link-extractor.ts";
import type { RawCommit } from "../changelog/types.ts";

const REPO = "https://github.com/org/repo";

// ─── extractLinks ────────────────────────────────────────────────────────────

describe("extractLinks", () => {
  describe("issue references", () => {
    it("parses 'closes #321'", () => {
      const { issues } = extractLinks("fix: auth error closes #321", REPO);
      expect(issues).toHaveLength(1);
      expect(issues[0]!.number).toBe("321");
      expect(issues[0]!.url).toBe(`${REPO}/issues/321`);
    });

    it("parses 'fixes #42' (without trailing s)", () => {
      const { issues } = extractLinks("fix stuff fixes #42", REPO);
      expect(issues[0]!.number).toBe("42");
    });

    it("parses 'resolves #7'", () => {
      const { issues } = extractLinks("resolves #7", REPO);
      expect(issues[0]!.number).toBe("7");
    });

    it("is case-insensitive (Closes, FIXES)", () => {
      expect(extractLinks("Closes #1", REPO).issues).toHaveLength(1);
      expect(extractLinks("FIXES #2", REPO).issues).toHaveLength(1);
    });

    it("deduplicates repeated issue refs", () => {
      const { issues } = extractLinks("closes #10 and also closes #10", REPO);
      expect(issues).toHaveLength(1);
    });

    it("extracts multiple distinct issues", () => {
      const { issues } = extractLinks("fixes #1 and closes #2", REPO);
      expect(issues).toHaveLength(2);
      expect(issues.map((i) => i.number)).toEqual(["1", "2"]);
    });
  });

  describe("PR references", () => {
    it("parses squash-merge style '(#328)'", () => {
      const { prs } = extractLinks("feat: add OAuth (#328)", REPO);
      expect(prs).toHaveLength(1);
      expect(prs[0]!.number).toBe("328");
      expect(prs[0]!.url).toBe(`${REPO}/pull/328`);
    });

    it("deduplicates repeated PR refs", () => {
      const { prs } = extractLinks("feat (#5) and (#5) again", REPO);
      expect(prs).toHaveLength(1);
    });

    it("extracts multiple distinct PRs", () => {
      const { prs } = extractLinks("feat (#10) (#20)", REPO);
      expect(prs).toHaveLength(2);
    });
  });

  describe("without repoUrl", () => {
    it("uses bare '#N' as URL when repoUrl is absent", () => {
      const { issues } = extractLinks("closes #99");
      expect(issues[0]!.url).toBe("#99");
    });

    it("uses bare '#N' for PRs too", () => {
      const { prs } = extractLinks("feat (#12)");
      expect(prs[0]!.url).toBe("#12");
    });
  });

  describe("no references", () => {
    it("returns empty arrays for plain commit messages", () => {
      const { issues, prs } = extractLinks("feat: add dark mode", REPO);
      expect(issues).toHaveLength(0);
      expect(prs).toHaveLength(0);
    });

    it("returns empty arrays for empty string", () => {
      const result = extractLinks("", REPO);
      expect(result.issues).toHaveLength(0);
      expect(result.prs).toHaveLength(0);
    });
  });
});

// ─── formatLinksMarkdown ─────────────────────────────────────────────────────

describe("formatLinksMarkdown", () => {
  it("returns empty string when no links", () => {
    expect(formatLinksMarkdown({ issues: [], prs: [] })).toBe("");
  });

  it("formats a single issue", () => {
    const md = formatLinksMarkdown({
      issues: [{ number: "321", url: `${REPO}/issues/321` }],
      prs: [],
    });
    expect(md).toBe(` (closes [#321](${REPO}/issues/321))`);
  });

  it("formats a single PR", () => {
    const md = formatLinksMarkdown({
      issues: [],
      prs: [{ number: "328", url: `${REPO}/pull/328` }],
    });
    expect(md).toBe(` ([PR #328](${REPO}/pull/328))`);
  });

  it("formats issue and PR together", () => {
    const md = formatLinksMarkdown({
      issues: [{ number: "321", url: `${REPO}/issues/321` }],
      prs: [{ number: "328", url: `${REPO}/pull/328` }],
    });
    expect(md).toBe(` (closes [#321](${REPO}/issues/321), [PR #328](${REPO}/pull/328))`);
  });

  it("formats multiple issues", () => {
    const md = formatLinksMarkdown({
      issues: [
        { number: "1", url: `${REPO}/issues/1` },
        { number: "2", url: `${REPO}/issues/2` },
      ],
      prs: [],
    });
    expect(md).toBe(` (closes [#1](${REPO}/issues/1), closes [#2](${REPO}/issues/2))`);
  });
});

// ─── buildCommitLinksMap ─────────────────────────────────────────────────────

function makeCommit(hash: string, message: string, body?: string): RawCommit {
  return {
    hash,
    treeHash: "tree",
    author: "test",
    date: new Date("2026-01-01"),
    message,
    body,
    files: [],
    diffSummary: "",
    isConventional: true,
  };
}

describe("buildCommitLinksMap", () => {
  it("returns empty map when no commits have refs", () => {
    const commits = [makeCommit("aaa", "feat: add dark mode")];
    const map = buildCommitLinksMap(commits, REPO);
    expect(map.size).toBe(0);
  });

  it("maps hash to links extracted from message", () => {
    const commits = [makeCommit("bbb", "fix: auth error closes #321 (#99)")];
    const map = buildCommitLinksMap(commits, REPO);
    expect(map.has("bbb")).toBe(true);
    expect(map.get("bbb")!.issues[0]!.number).toBe("321");
    expect(map.get("bbb")!.prs[0]!.number).toBe("99");
  });

  it("extracts refs from body as well as message", () => {
    const commits = [makeCommit("ccc", "feat: add OAuth", "This closes #42")];
    const map = buildCommitLinksMap(commits, REPO);
    expect(map.get("ccc")!.issues[0]!.number).toBe("42");
  });

  it("only includes commits that have at least one ref", () => {
    const commits = [
      makeCommit("plain", "refactor: clean up"),
      makeCommit("linked", "fix: crash closes #5"),
    ];
    const map = buildCommitLinksMap(commits, REPO);
    expect(map.has("plain")).toBe(false);
    expect(map.has("linked")).toBe(true);
  });

  it("handles multiple commits independently", () => {
    const commits = [makeCommit("h1", "fix: a closes #1"), makeCommit("h2", "fix: b closes #2")];
    const map = buildCommitLinksMap(commits, REPO);
    expect(map.get("h1")!.issues[0]!.number).toBe("1");
    expect(map.get("h2")!.issues[0]!.number).toBe("2");
  });
});
