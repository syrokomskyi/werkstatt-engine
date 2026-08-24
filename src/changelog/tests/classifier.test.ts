import { describe, it, expect } from "vitest";
import { deterministicClassify } from "../changelog/agents/classifier-agent.ts";
import type { RawCommit } from "../changelog/types.ts";

function makeCommit(overrides: Partial<RawCommit> & { message: string }): RawCommit {
  return {
    hash: "deadbeef",
    treeHash: "tree123",
    author: "test",
    date: new Date("2026-01-01"),
    files: [],
    diffSummary: "",
    isConventional: false,
    ...overrides,
  };
}

describe("deterministicClassify", () => {
  describe("SKIP_PATTERNS", () => {
    it("marks lockfile bump commits as skip", () => {
      const c = makeCommit({
        message: "chore: bump version",
        isConventional: true,
        conventionalType: "chore",
      });
      expect(deterministicClassify(c).type).toBe("skip");
    });

    it("marks dep update commits as skip", () => {
      const c = makeCommit({
        message: "chore: update deps",
        isConventional: true,
        conventionalType: "chore",
      });
      expect(deterministicClassify(c).type).toBe("skip");
    });

    it("marks build: commits as skip", () => {
      const c = makeCommit({ message: "build: update webpack config" });
      expect(deterministicClassify(c).type).toBe("skip");
    });

    it("marks ci: commits as skip", () => {
      const c = makeCommit({ message: "ci: update node version" });
      expect(deterministicClassify(c).type).toBe("skip");
    });

    it("skip has confidence 1.0", () => {
      const c = makeCommit({ message: "chore: bump version" });
      expect(deterministicClassify(c).confidence).toBe(1.0);
    });
  });

  describe("conventional commits", () => {
    it("feat: → type=feat, severity=minor, confidence=0.95", () => {
      const c = makeCommit({
        message: "feat: add dark mode",
        isConventional: true,
        conventionalType: "feat",
      });
      const r = deterministicClassify(c);
      expect(r.type).toBe("feat");
      expect(r.severity).toBe("minor");
      expect(r.confidence).toBe(0.95);
    });

    it("fix: → type=fix, severity=patch", () => {
      const c = makeCommit({
        message: "fix: correct auth error",
        isConventional: true,
        conventionalType: "fix",
      });
      const r = deterministicClassify(c);
      expect(r.type).toBe("fix");
      expect(r.severity).toBe("patch");
    });

    it("refactor: → type=refactor, severity=patch", () => {
      const c = makeCommit({
        message: "refactor: simplify parser",
        isConventional: true,
        conventionalType: "refactor",
      });
      const r = deterministicClassify(c);
      expect(r.type).toBe("refactor");
      expect(r.severity).toBe("patch");
    });

    it("feat(auth): → module=auth", () => {
      const c = makeCommit({
        message: "feat(auth): add OAuth",
        isConventional: true,
        conventionalType: "feat",
      });
      expect(deterministicClassify(c).module).toBe("auth");
    });

    it("no scope → module=general", () => {
      const c = makeCommit({
        message: "feat: add feature",
        isConventional: true,
        conventionalType: "feat",
      });
      expect(deterministicClassify(c).module).toBe("general");
    });

    it("summary is trimmed text after colon", () => {
      const c = makeCommit({
        message: "feat: add dark mode",
        isConventional: true,
        conventionalType: "feat",
      });
      expect(deterministicClassify(c).summary).toBe("add dark mode");
    });
  });

  describe("breaking changes", () => {
    it("feat!: → type=breaking, isBreaking=true", () => {
      const c = makeCommit({
        message: "feat!: remove legacy API",
        isConventional: true,
        conventionalType: "feat",
      });
      const r = deterministicClassify(c);
      expect(r.type).toBe("breaking");
      expect(r.isBreaking).toBe(true);
    });

    it("feat with BREAKING CHANGE in body → isBreaking=true", () => {
      const c = makeCommit({
        message: "feat: redesign auth",
        body: "BREAKING CHANGE: token format changed",
        isConventional: true,
        conventionalType: "feat",
      });
      const r = deterministicClassify(c);
      expect(r.type).toBe("breaking");
      expect(r.isBreaking).toBe(true);
    });

    it("breaking commit → severity=minor (not none)", () => {
      const c = makeCommit({
        message: "feat!: remove API",
        isConventional: true,
        conventionalType: "feat",
      });
      expect(deterministicClassify(c).severity).toBe("minor");
    });
  });

  describe("non-conventional commits", () => {
    it("free-form message → type=chore, confidence=0.5", () => {
      const c = makeCommit({ message: "updated some stuff", isConventional: false });
      const r = deterministicClassify(c);
      expect(r.type).toBe("chore");
      expect(r.confidence).toBe(0.5);
      expect(r.severity).toBe("patch");
      expect(r.isConventional).toBe(false);
    });

    it("summary is truncated to 100 chars", () => {
      const long = "a".repeat(150);
      const c = makeCommit({ message: long, isConventional: false });
      expect(deterministicClassify(c).summary).toHaveLength(100);
    });
  });
});
