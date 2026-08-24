import { test, expect, describe } from "vitest";
import path from "node:path";
import { stableStringify } from "../json.ts";
import {
  integrityRoot,
  configDir,
  schemaDir,
  policyPath,
  indexDir,
  entitiesByIdPath,
  currentPathsPath,
  manifestPathForDirectory,
  buildDir,
  buildLatestDir,
  outputsPath,
  provenancePath,
  signatureBinaryPath,
  signatureHexPath,
  signedManifestPath,
} from "../paths.ts";

describe("stableStringify", () => {
  test("sorts keys alphabetically", () => {
    const result = stableStringify({ z: 1, a: 2, m: 3 });
    expect(result.indexOf('"a"')).toBeLessThan(result.indexOf('"m"'));
    expect(result.indexOf('"m"')).toBeLessThan(result.indexOf('"z"'));
  });

  test("sorts nested object keys", () => {
    const result = stableStringify({ outer: { z: 1, a: 2 } });
    expect(result.indexOf('"a"')).toBeLessThan(result.indexOf('"z"'));
  });

  test("preserves array order", () => {
    const result = stableStringify({ items: ["c", "a", "b"] });
    expect(result).toContain('"c"');
    expect(result).toContain('"a"');
    expect(result).toContain('"b"');
    const cPos = result.indexOf('"c"');
    const aPos = result.indexOf('"a"');
    expect(cPos).toBeLessThan(aPos);
  });

  test("is deterministic — same input produces same output", () => {
    const obj = { b: 2, a: 1, c: { z: 9, y: 8 } };
    expect(stableStringify(obj)).toBe(stableStringify(obj));
  });

  test("produces different output for different key orders in input", () => {
    const a = stableStringify({ a: 1, b: 2 });
    const b = stableStringify({ b: 2, a: 1 });
    expect(a).toBe(b);
  });

  test("ends with newline", () => {
    expect(stableStringify({}).endsWith("\n")).toBe(true);
  });

  test("handles primitives", () => {
    expect(stableStringify(42)).toBe("42\n");
    expect(stableStringify("hello")).toBe('"hello"\n');
    expect(stableStringify(null)).toBe("null\n");
  });
});

describe("integrity paths", () => {
  const cwd = "/test/project";

  test("integrityRoot returns .integrity under cwd", () => {
    expect(integrityRoot(cwd)).toBe(path.join(cwd, ".integrity"));
  });

  test("configDir is under integrityRoot", () => {
    expect(configDir(cwd)).toBe(path.join(cwd, ".integrity", "config"));
  });

  test("schemaDir is under integrityRoot", () => {
    expect(schemaDir(cwd)).toBe(path.join(cwd, ".integrity", "schema"));
  });

  test("policyPath is under configDir", () => {
    expect(policyPath(cwd)).toBe(path.join(cwd, ".integrity", "config", "policy.json"));
  });

  test("indexDir is under integrityRoot", () => {
    expect(indexDir(cwd)).toBe(path.join(cwd, ".integrity", "index"));
  });

  test("entitiesByIdPath is under indexDir", () => {
    expect(entitiesByIdPath(cwd)).toBe(
      path.join(cwd, ".integrity", "index", "entities.by-id.json"),
    );
  });

  test("currentPathsPath is under indexDir", () => {
    expect(currentPathsPath(cwd)).toBe(path.join(cwd, ".integrity", "index", "paths.current.json"));
  });

  test("manifestPathForDirectory uses 'root' for '.'", () => {
    expect(manifestPathForDirectory(cwd, ".")).toBe(
      path.join(cwd, ".integrity", "manifests", "root", "versions.json"),
    );
  });

  test("manifestPathForDirectory uses repoDir for non-dot", () => {
    expect(manifestPathForDirectory(cwd, "packages/foo")).toBe(
      path.join(cwd, ".integrity", "manifests", "packages/foo", "versions.json"),
    );
  });

  test("build paths are nested correctly", () => {
    expect(buildDir(cwd)).toBe(path.join(cwd, ".integrity", "build"));
    expect(buildLatestDir(cwd)).toBe(path.join(cwd, ".integrity", "build", "latest"));
    expect(outputsPath(cwd)).toBe(path.join(cwd, ".integrity", "build", "latest", "outputs.json"));
    expect(provenancePath(cwd)).toBe(
      path.join(cwd, ".integrity", "build", "latest", "build-provenance.json"),
    );
  });

  test("signature paths are under buildLatestDir", () => {
    expect(signatureBinaryPath(cwd)).toBe(
      path.join(cwd, ".integrity", "build", "latest", "signature.bin"),
    );
    expect(signatureHexPath(cwd)).toBe(
      path.join(cwd, ".integrity", "build", "latest", "signature.hex"),
    );
    expect(signedManifestPath(cwd)).toBe(
      path.join(cwd, ".integrity", "build", "latest", "signed-manifest.json"),
    );
  });
});
