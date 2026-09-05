import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  EffectClassifier,
  getDefaultEffectClassifier,
  resetDefaultEffectClassifier,
} from "../effect-classifier.ts";
import type { EffectDeclarationExt } from "../../component/contracts.ts";

describe("EffectClassifier", () => {
  it("classifies known operations", () => {
    const classifier = getDefaultEffectClassifier();
    expect(classifier.classify("leitstand.propagate")).toBe("compensatable");
    expect(classifier.classify("mission.close")).toBe("irreversible-emission");
    expect(classifier.classify("sternsystem.sync")).toBe("compensatable");
    expect(classifier.classify("release.prepare")).toBe("irreversible-emission");
  });

  it("throws EFFECT-03 for unknown operations", () => {
    const classifier = getDefaultEffectClassifier();
    expect(() => classifier.classify("unknown.operation")).toThrow(/EFFECT-03/);
  });

  it("getDeclaration returns the full declaration", () => {
    const classifier = getDefaultEffectClassifier();
    const decl = classifier.getDeclaration("leitstand.propagate");
    expect(decl).not.toBeNull();
    expect(decl?.effectClass).toBe("compensatable");
    expect(decl?.compensation).toBeDefined();
    expect(decl?.compensation?.verificationProbes.length).toBeGreaterThan(0);
  });

  it("getDeclaration returns null for unknown operations", () => {
    const classifier = getDefaultEffectClassifier();
    expect(classifier.getDeclaration("unknown.operation")).toBeNull();
  });

  it("has() checks operation existence", () => {
    const classifier = getDefaultEffectClassifier();
    expect(classifier.has("leitstand.propagate")).toBe(true);
    expect(classifier.has("unknown.operation")).toBe(false);
  });

  it("supports custom declarations", () => {
    const customDecls: EffectDeclarationExt[] = [
      {
        effectClass: "revertible",
        description: "Custom revertible op",
        recoveryCommand: "custom.revert",
        commitMetadata: null,
      },
    ];
    const classifier = new EffectClassifier(customDecls);
    expect(classifier.classify("custom.revert")).toBe("revertible");
  });

  it("default classifier is a singleton", () => {
    const a = getDefaultEffectClassifier();
    const b = getDefaultEffectClassifier();
    expect(a).toBe(b);
  });

  it("resetDefaultEffectClassifier creates a new singleton", () => {
    const a = getDefaultEffectClassifier();
    resetDefaultEffectClassifier();
    const b = getDefaultEffectClassifier();
    expect(a).not.toBe(b);
  });
});
